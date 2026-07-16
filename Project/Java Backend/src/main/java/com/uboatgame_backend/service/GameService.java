package com.uboatgame_backend.service;

import com.uboatgame_backend.dto.ApiDtos.*;
import com.uboatgame_backend.mapper.GameMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;

@Service
public class GameService {
    public static final String AUTH_ATTR = "authUser";

    private static final double MAP_SIZE = 12150.0;
    private static final int MAX_PLAYERS = 8;
    private static final int CARGO_COUNT = 20;
    private static final int CARGO_ROWS = 4;
    private static final int CARGO_COLS = 5;
    private static final double CARGO_LATERAL_SPACING = 261.0;
    private static final double CARGO_LONGITUDINAL_SPACING_MIN = 130.0;
    private static final double CARGO_LONGITUDINAL_SPACING_MAX = 210.0;
    private static final double CARGO_DEVIATION = 50.0;
    private static final double CARGO_SPEED = 7.0;
    private static final int CARGO_TONNAGE = 15000;
    private static final int U_BOAT_TONNAGE = 980;
    private static final double SCENE_TO_METERS = 77.0 / 22.0;
    private static final double WORLD_TICK_SECONDS = 0.5;
    private static final int INITIAL_TORPEDOES = 14;
    private static final String[] LOCATION_LEVEL_1_CODES = {
            "AD", "AE", "AF",
            "AK", "AL", "AM",
            "BD", "BE", "BF"
    };
    private static final String[] LOCATION_LEVEL_CODES = {
            "1", "2", "3",
            "4", "5", "6",
            "7", "8", "9"
    };

    private final GameMapper mapper;
    private final ObjectMapper objectMapper;
    private final DatabaseAccess databaseAccess;
    private final int tokenTtlDays;

    public GameService(GameMapper mapper, ObjectMapper objectMapper, DatabaseAccess databaseAccess,
                       @Value("${app.auth.token-ttl-days:7}") int tokenTtlDays) {
        this.mapper = mapper;
        this.objectMapper = objectMapper;
        this.databaseAccess = databaseAccess;
        this.tokenTtlDays = tokenTtlDays;
    }

    public Optional<AuthUser> authenticate(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return Optional.empty();
        }
        String token = authorization.substring("Bearer ".length()).trim();
        if (token.isEmpty()) {
            return Optional.empty();
        }
        return mapper.findAuthUserByToken(token).stream().findFirst().map(this::authUser);
    }

    @Transactional
    public Map<String, Object> registration(RegistrationRequest request) {
        String name = trim(request.KommandantName());
        String numericUBoatId = trim(request.UBoatID());
        if (name == null || name.isBlank()) {
            return fail("指挥官姓名不能为空");
        }
        if (numericUBoatId == null || !numericUBoatId.matches("\\d+")) {
            return fail("潜艇编号格式错误，请输入数字");
        }
        String uBoatId = "U-" + Integer.parseInt(numericUBoatId);
        String uuid = UUID.randomUUID().toString();
        try {
            mapper.insertCommander(uuid, name, uBoatId);
        } catch (DuplicateKeyException ex) {
            return fail("潜艇编号已被使用");
        }
        return mapOf("sf", true, "message", "注册成功", "KommandantUUID", uuid);
    }

    @Transactional
    public Map<String, Object> login(LoginRequest request) {
        String uuid = trim(request.KommandantUUID());
        if (uuid == null || uuid.isBlank()) {
            return fail("KommandantUUID不能为空");
        }
        Optional<AuthUser> user = mapper.findCommanderByUuid(uuid).stream().findFirst().map(this::authUser);
        if (user.isEmpty()) {
            return fail("指挥官不存在");
        }
        String token = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        mapper.insertAuthToken(token, uuid, Timestamp.from(Instant.now().plus(tokenTtlDays, ChronoUnit.DAYS)));
        return mapOf(
                "sf", true,
                "message", "登录成功",
                "token", token,
                "KommandantUUID", user.get().kommandantUUID(),
                "KommandantName", user.get().kommandantName(),
                "UBoatID", user.get().uBoatID()
        );
    }

    public Map<String, Object> roomInfo() {
        List<RoomInfo> rooms = mapper.selectOpenRoomInfos().stream().map(this::roomInfo).toList();
        return mapOf("sf", true, "rooms", rooms);
    }

    @Transactional
    public Map<String, Object> createRoom(AuthUser user, RoomCreateRequest request) {
        leaveOtherRooms(user.kommandantUUID(), null);
        String roomId = UUID.randomUUID().toString();
        int maxPlayers = request.maxPlayers() == null ? MAX_PLAYERS : Math.min(Math.max(request.maxPlayers(), 1), MAX_PLAYERS);
        String roomName = trim(request.roomName());
        if (roomName == null || roomName.isBlank()) {
            roomName = "Room-" + roomId.substring(0, 8);
        }
        String startSide = randomBool() ? "left" : "right";
        mapper.insertRoom(roomId, roomName, maxPlayers, user.kommandantUUID(), startSide);
        joinRoomInternal(user, roomId);
        generateCargoShips(roomId, startSide);
        addConvoyInitialNotice(roomId);
        touchRoom(roomId);
        return roomJoinResponse("房间创建成功", roomId);
    }

    @Transactional
    public Map<String, Object> enterRoom(AuthUser user, RoomIdRequest request) {
        String roomId = trim(request.RoomID());
        return databaseAccess.withRoomWriteLock(roomId, () -> {
            if (!openRoomExists(roomId)) {
                return fail("房间不存在或已关闭");
            }
            if (isActiveRoomPlayer(roomId, user.kommandantUUID())) {
                return roomJoinResponse("已在房间中", roomId);
            }
            int maxPlayers = mapper.selectRoomMaxPlayers(roomId);
            int activePlayers = activePlayerCount(roomId);
            if (activePlayers >= maxPlayers) {
                return fail("房间已满");
            }
            leaveOtherRooms(user.kommandantUUID(), roomId);
            joinRoomInternal(user, roomId);
            addConvoyInitialNotice(roomId);
            touchRoom(roomId);
            return roomJoinResponse("进入房间成功", roomId);
        });
    }

    public Map<String, Object> roomDetail(String roomId) {
        if (!openRoomExists(roomId)) {
            return fail("房间不存在或已关闭");
        }
        return mapOf("sf", true, "room", getRoomDetailObject(roomId));
    }

    public Map<String, Object> playerRecord(AuthUser user) {
        if (user == null || user.kommandantUUID() == null || user.kommandantUUID().isBlank()) {
            return fail("请登录，再查询战绩");
        }
        Map<String, Object> summaryRow = mapper.selectPlayerRecordSummary(user.kommandantUUID());
        PlayerRecordSummary summary = new PlayerRecordSummary(
                integer(summaryRow, "cargo_ships_sunk", "cargoShipsSunk"),
                integer(summaryRow, "u_boats_sunk", "uBoatsSunk"),
                integer(summaryRow, "total_tonnage", "totalTonnage"),
                integer(summaryRow, "games_played", "gamesPlayed"));
        List<PlayerGameRecord> games = mapper.selectPlayerGameRecords(user.kommandantUUID())
                .stream()
                .map(this::playerGameRecord)
                .toList();
        return mapOf("sf", true, "summary", summary, "games", games);
    }

    @Transactional
    public Map<String, Object> leaveRoom(AuthUser user, RoomIdRequest request) {
        String roomId = trim(request.RoomID());
        return databaseAccess.withRoomWriteLock(roomId, () -> {
            if (roomId == null || roomId.isBlank()) {
                return fail("RoomID不能为空");
            }
            mapper.markRoomPlayerLeft(roomId, user.kommandantUUID());
            removePlayerModels(roomId, user.kommandantUUID());
            if (activePlayerCount(roomId) == 0) {
                mapper.closeRoom(roomId);
            }
            touchRoom(roomId);
            return mapOf("sf", true, "message", "已离开房间");
        });
    }

    @Transactional
    public Map<String, Object> sendTextMessage(AuthUser user, TextMessageRequest request) {
        String roomId = request.RoomID();
        return databaseAccess.withRoomWriteLock(roomId, () -> {
            if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
                return fail("未加入该房间");
            }
            if (request.receiverUUIDs() == null || request.receiverUUIDs().isEmpty()) {
                return fail("接收人不能为空");
            }
            String content = trim(request.content());
            if (content == null || content.isBlank()) {
                return fail("消息内容不能为空");
            }
            String messageId = UUID.randomUUID().toString();
            mapper.insertTextMessage(messageId, roomId, user.kommandantUUID(), user.kommandantName(),
                    writeJson(request.receiverUUIDs()), content);
            touchRoom(roomId);
            return mapOf("sf", true, "message", "发送成功", "data", textMessage(mapper.selectTextMessage(messageId)));
        });
    }

    public Map<String, Object> receiveTextMessages(AuthUser user, String roomId, String after) {
        if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
            return fail("未加入该房间");
        }
        List<Map<String, Object>> rows = hasText(after)
                ? mapper.selectVisibleMessagesAfter(roomId, user.kommandantUUID(), after)
                : mapper.selectVisibleMessages(roomId, user.kommandantUUID());
        return mapOf("sf", true, "messages", rows.stream().map(this::textMessage).toList());
    }

    public Map<String, Object> serverNotices(AuthUser user, String roomId, String after) {
        if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
            return fail("未加入该房间");
        }
        List<Map<String, Object>> rows = hasText(after)
                ? mapper.selectServerNoticesAfter(roomId, after)
                : mapper.selectServerNotices(roomId);
        return mapOf("sf", true, "notices", rows.stream().map(this::serverNotice).toList());
    }

    @Transactional
    public Map<String, Object> syncUBoat(AuthUser user, WorldSyncRequest request) {
        String roomId = request.RoomID();
        System.out.println("【本艇同步接口】收到本艇同步请求：roomId=" + roomId + "，指挥官=" + user.kommandantUUID());
        return databaseAccess.withRoomWriteLock(roomId, () -> {
            if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
                System.out.println("【本艇同步接口】拒绝同步：玩家未加入房间，roomId=" + roomId);
                return fail("未加入该房间");
            }
            OnlineUBoatState u = request.selfUBoat();
            if (u == null || u.modelID() == null || u.location() == null) {
                System.out.println("【本艇同步接口】拒绝同步：本艇状态不完整，roomId=" + roomId);
                return fail("本艇状态不完整");
            }
            if (!u.KommandantUUID().equals(user.kommandantUUID())) {
                System.out.println("【本艇同步接口】拒绝同步：不能上传其他玩家潜艇，modelID=" + u.modelID());
                return fail("不能上传其他玩家的潜艇状态");
            }
            int updated = mapper.updateUBoatState(roomId, u.modelID(), user.kommandantUUID(), u.headingDegrees(),
                    u.speedKmh(), u.location().x(), u.location().z(), u.depthMeters(), u.navigationState());
            System.out.println("【本艇同步接口】数据库更新本艇状态：modelID=" + u.modelID()
                    + "，updatedRows=" + updated + "，" + (updated > 0 ? "更新成功" : "更新失败"));
            if (updated == 0) {
                return fail("本艇模型不存在或不属于当前玩家");
            }
            int touchedPlayer = mapper.touchRoomPlayer(roomId, user.kommandantUUID());
            System.out.println("【本艇同步接口】数据库更新玩家在线时间：updatedRows=" + touchedPlayer);
            touchRoom(roomId);
            System.out.println("【本艇同步接口】房间版本已更新，同步成功：roomId=" + roomId);
            return mapOf("sf", true, "message", "同步成功");
        });
    }

    @Transactional
    public Map<String, Object> syncTorpedo(AuthUser user, TorpedoSyncRequest request) {
        String roomId = request.RoomID();
        System.out.println("【鱼雷同步接口】收到鱼雷同步请求：roomId=" + roomId + "，指挥官=" + user.kommandantUUID());
        return databaseAccess.withRoomWriteLock(roomId, () -> {
            OnlineTorpedoState t = request.torpedo();
            if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
                System.out.println("【鱼雷同步接口】拒绝鱼雷：玩家未加入房间，roomId=" + roomId);
                return invalidTorpedo("未加入该房间", "NOT_IN_ROOM");
            }
            if (t == null || t.modelID() == null || t.ownerModelID() == null || t.location() == null) {
                System.out.println("【鱼雷同步接口】拒绝鱼雷：鱼雷状态不完整，roomId=" + roomId);
                return invalidTorpedo("鱼雷状态不完整", "TORPEDO_STATE_INCOMPLETE");
            }
            System.out.println("【鱼雷同步接口】鱼雷参数：torpedoModelID=" + t.modelID()
                    + "，ownerModelID=" + t.ownerModelID()
                    + "，位置=(" + t.location().x() + ", " + t.location().z() + ")");
            if (!uboatOwnedBy(roomId, t.ownerModelID(), user.kommandantUUID())) {
                System.out.println("【鱼雷同步接口】拒绝鱼雷：所属潜艇不属于当前玩家，torpedoModelID=" + t.modelID());
                return invalidTorpedo("鱼雷所属潜艇不属于当前玩家", "TORPEDO_OWNER_INVALID");
            }
            boolean knownLaunch = mapper.countTorpedoLaunch(roomId, t.modelID()) > 0;
            if (!knownLaunch) {
                Integer remaining = mapper.selectTorpedoesRemaining(roomId, t.ownerModelID(), user.kommandantUUID());
                System.out.println("【鱼雷同步接口】数据库查询剩余鱼雷：ownerModelID=" + t.ownerModelID() + "，remaining=" + remaining);
                if (remaining == null || remaining <= 0) {
                    System.out.println("【鱼雷同步接口】拒绝鱼雷：数据库显示鱼雷已用尽，torpedoModelID=" + t.modelID());
                    evaluateGameResult(roomId);
                    Map<String, Object> response = invalidTorpedo("鱼雷已用尽", "TORPEDO_DEPLETED");
                    gameResult(roomId).ifPresent(result -> response.put("gameResult", result));
                    return response;
                }
                int inserted = mapper.insertTorpedoLaunch(roomId, t.modelID(), t.ownerModelID(), user.kommandantUUID());
                System.out.println("【鱼雷同步接口】数据库登记鱼雷发射记录：torpedoModelID=" + t.modelID()
                        + "，inserted=" + inserted + "，" + (inserted > 0 ? "登记成功" : "已存在，跳过登记"));
                if (inserted > 0) {
                    int decremented = mapper.decrementTorpedoes(roomId, t.ownerModelID(), user.kommandantUUID());
                    System.out.println("【鱼雷同步接口】数据库扣减本艇鱼雷：ownerModelID=" + t.ownerModelID()
                            + "，updatedRows=" + decremented + "，" + (decremented > 0 ? "扣减成功" : "扣减失败"));
                }
            } else {
                System.out.println("【鱼雷同步接口】数据库已存在鱼雷发射记录：torpedoModelID=" + t.modelID() + "，本次不重复扣减鱼雷");
            }
            int synced = mapper.upsertTorpedoState(roomId, t.modelID(), t.ownerModelID(), t.headingDegrees(), t.speedKnots(),
                    t.location().x(), t.location().z(), t.depthMeters());
            System.out.println("【鱼雷同步接口】数据库同步鱼雷状态：torpedoModelID=" + t.modelID()
                    + "，affectedRows=" + synced + "，同步完成");
            evaluateGameResult(roomId);
            touchRoom(roomId);
            System.out.println("【鱼雷同步接口】房间版本已更新，鱼雷同步成功：roomId=" + roomId + "，torpedoModelID=" + t.modelID());
            Map<String, Object> response = mapOf("sf", true, "message", "鱼雷同步成功");
            gameResult(roomId).ifPresent(result -> response.put("gameResult", result));
            return response;
        });
    }

    public Map<String, Object> world(AuthUser user, String roomId) {
        if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
            return fail("未加入该房间");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sf", true);
        result.put("revision", String.valueOf(roomRevision(roomId)));
        result.put("uBoats", uboats(roomId));
        result.put("cargoShips", cargoShips(roomId));
        result.put("torpedoes", torpedoes(roomId));
        settlementFor(roomId, user.kommandantUUID()).ifPresent(s -> result.put("settlement", s));
        result.put("gameResult", gameResult(roomId).orElse(new GameResult(roomId, "playing", null,
                sunkCargoCount(roomId), CARGO_COUNT, sunkCargoCount(roomId) / (double) CARGO_COUNT)));
        return result;
    }

    @Transactional
    public Map<String, Object> reportHit(AuthUser user, HitReportRequest request) {
        String roomId = request.RoomID();
        System.out.println("【命中上报接口】收到命中上报：roomId=" + roomId
                + "，attackerModelID=" + request.attackerModelID()
                + "，targetModelID=" + request.targetModelID()
                + "，torpedoModelID=" + request.torpedoModelID());
        return databaseAccess.withRoomWriteLock(roomId, () -> {
            if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
                System.out.println("【命中上报接口】拒绝上报：玩家未加入房间，roomId=" + roomId);
                return fail("未加入该房间");
            }
            if (!uboatOwnedBy(roomId, request.attackerModelID(), user.kommandantUUID())) {
                System.out.println("【命中上报接口】拒绝上报：攻击者潜艇不属于当前玩家，attackerModelID=" + request.attackerModelID());
                return fail("攻击者模型不属于当前玩家");
            }
            if (mapper.countTorpedoLaunchOwnedBy(roomId, request.torpedoModelID(), request.attackerModelID()) == 0) {
                System.out.println("【命中上报接口】拒绝上报：数据库未找到攻击者鱼雷发射记录，torpedoModelID=" + request.torpedoModelID());
                return fail("鱼雷不存在或不属于攻击者");
            }
            if (mapper.countHitReport(roomId, request.targetModelID()) > 0) {
                System.out.println("【命中上报接口】数据库已有命中记录，跳过重复登记：targetModelID=" + request.targetModelID());
                return mapOf("sf", true, "message", "命中已记录", "data", lifecycleFor(roomId, request.targetModelID(), request.targetType()));
            }
            Target target = target(roomId, request.targetModelID(), request.targetType());
            if (target == null) {
                return fail("目标不存在");
            }
            if ("sunk".equals(target.lifecycleState())) {
                return fail("目标已沉没");
            }
            Timestamp hitTime = parseTimestamp(request.hitTime(), Instant.now());
            int inserted = mapper.insertHitReport(roomId, request.targetModelID(), request.attackerModelID(), request.targetType(),
                    request.torpedoModelID(), hitTime, user.kommandantUUID());
            System.out.println("【命中上报接口】数据库登记命中记录：targetModelID=" + request.targetModelID()
                    + "，inserted=" + inserted + "，" + (inserted > 0 ? "登记成功" : "登记失败"));
            if ("cargoShip".equals(request.targetType())) {
                int marked = mapper.markCargoHit(roomId, request.targetModelID(), request.attackerModelID(), user.kommandantUUID(), hitTime);
                System.out.println("【命中上报接口】数据库标记商船下沉中：targetModelID=" + request.targetModelID() + "，updatedRows=" + marked);
            } else {
                int marked = mapper.markUBoatHit(roomId, request.targetModelID(), request.attackerModelID(), user.kommandantUUID(), hitTime);
                System.out.println("【命中上报接口】数据库标记潜艇下沉中：targetModelID=" + request.targetModelID() + "，updatedRows=" + marked);
            }
            int deleted = mapper.deleteTorpedoState(roomId, request.torpedoModelID());
            System.out.println("【命中上报接口】数据库删除已命中鱼雷状态：torpedoModelID=" + request.torpedoModelID() + "，deletedRows=" + deleted);
            touchRoom(roomId);
            return mapOf("sf", true, "message", "命中已记录", "data", lifecycleFor(roomId, request.targetModelID(), request.targetType()));
        });
    }

    @Transactional
    public Map<String, Object> confirmSunk(AuthUser user, SunkConfirmRequest request) {
        String roomId = request.RoomID();
        System.out.println("【沉没确认接口】收到沉没确认：roomId=" + roomId
                + "，modelID=" + request.modelID()
                + "，modelType=" + request.modelType());
        return databaseAccess.withRoomWriteLock(roomId, () -> {
            if (!isActiveRoomPlayer(roomId, user.kommandantUUID())) {
                System.out.println("【沉没确认接口】拒绝确认：玩家未加入房间，roomId=" + roomId);
                return fail("未加入该房间");
            }
            Target target = target(roomId, request.modelID(), request.modelType());
            if (target == null) {
                System.out.println("【沉没确认接口】拒绝确认：数据库未找到模型，modelID=" + request.modelID());
                return fail("模型不存在");
            }
            if ("sunk".equals(target.lifecycleState())) {
                System.out.println("【沉没确认接口】数据库显示模型已沉没，跳过重复确认：modelID=" + request.modelID());
                return mapOf("sf", true, "message", "模型已沉没", "data", lifecycleFor(roomId, request.modelID(), request.modelType()));
            }
            if (!"sinking".equals(target.lifecycleState())) {
                System.out.println("【沉没确认接口】拒绝确认：模型尚未进入 sinking，modelID=" + request.modelID()
                        + "，当前状态=" + target.lifecycleState());
                return fail("模型尚未进入下沉状态");
            }
            Timestamp sunkAt = parseTimestamp(request.sunkAt(), Instant.now());
            if ("cargoShip".equals(request.modelType())) {
                int marked = mapper.markCargoSunk(roomId, request.modelID(), sunkAt);
                System.out.println("【沉没确认接口】数据库标记商船沉没：modelID=" + request.modelID() + "，updatedRows=" + marked);
                updateAttackerSettlement(roomId, request.modelID());
            } else {
                int marked = mapper.markUBoatSunk(roomId, request.modelID(), sunkAt);
                System.out.println("【沉没确认接口】数据库标记潜艇沉没：modelID=" + request.modelID() + "，updatedRows=" + marked);
                updateAttackerSettlement(roomId, request.modelID());
                updateVictimSettlement(roomId, request.modelID());
            }
            evaluateGameResult(roomId);
            touchRoom(roomId);
            return mapOf("sf", true, "message", "模型沉没已确认", "data", lifecycleFor(roomId, request.modelID(), request.modelType()));
        });
    }

    @Transactional
    public void tickWorld() {
        for (Map<String, Object> room : mapper.selectOpenRoomsForTick()) {
            String roomId = str(room, "room_id", "roomId");
            databaseAccess.withRoomWriteLock(roomId, () -> {
                moveCargoShips(roomId);
                cleanupTorpedoes(roomId);
                evaluateGameResult(roomId);
            });
        }
    }

    private void generateCargoShips(String roomId, String startSide) {
        double heading = randomConvoyHeading(startSide);
        double entryX = "left".equals(startSide) ? 0.0 : MAP_SIZE;
        double entryZ = randomRange(0, MAP_SIZE);
        double longitudinalSpacing = randomRange(CARGO_LONGITUDINAL_SPACING_MIN, CARGO_LONGITUDINAL_SPACING_MAX);
        double headingRadians = Math.toRadians(90.0 - heading);
        double forwardX = Math.cos(headingRadians);
        double forwardZ = -Math.sin(headingRadians);
        double rightX = -forwardZ;
        double rightZ = forwardX;

        List<Position> positions = new ArrayList<>();
        for (int row = 0; row < CARGO_ROWS; row++) {
            for (int col = 0; col < CARGO_COLS; col++) {
                double lateralOffset = (col - (CARGO_COLS - 1) / 2.0) * CARGO_LATERAL_SPACING;
                double longitudinalOffset = row * longitudinalSpacing;
                double jitterLateral = randomSigned(CARGO_DEVIATION);
                double jitterLongitudinal = randomSigned(CARGO_DEVIATION);
                double shipX = entryX
                        + forwardX * (longitudinalOffset + jitterLongitudinal)
                        + rightX * (lateralOffset + jitterLateral);
                double shipZ = entryZ
                        + forwardZ * (longitudinalOffset + jitterLongitudinal)
                        + rightZ * (lateralOffset + jitterLateral);
                positions.add(new Position(shipX, shipZ));
            }
        }

        shiftConvoyIntoMap(positions, startSide);

        for (Position position : positions) {
            mapper.insertCargoShip(roomId, UUID.randomUUID().toString(), heading, CARGO_SPEED,
                    position.x(), position.z(), CARGO_TONNAGE);
        }
    }

    private void joinRoomInternal(AuthUser user, String roomId) {
        mapper.upsertRoomPlayer(roomId, user.kommandantUUID());
        Position pos = randomUBoatPosition(roomId);
        mapper.insertUBoatState(roomId, UUID.randomUUID().toString(), user.kommandantUUID(), user.kommandantName(),
                user.uBoatID(), randomRange(0, 360), pos.x(), pos.z(), INITIAL_TORPEDOES);
    }

    private Position randomUBoatPosition(String roomId) {
        Set<Integer> usedCells = new HashSet<>();
        for (Map<String, Object> row : mapper.selectActiveUBoatLocations(roomId)) {
            int cx = Math.min(8, (int) (dbl(row, "location_x", "locationX") / 1350.0));
            int cz = Math.min(8, (int) (dbl(row, "location_z", "locationZ") / 1350.0));
            usedCells.add(cz * 9 + cx);
        }
        List<Integer> available = new ArrayList<>();
        for (int i = 0; i < 81; i++) {
            if (!usedCells.contains(i)) {
                available.add(i);
            }
        }
        int cell = available.get(ThreadLocalRandom.current().nextInt(available.size()));
        int cx = cell % 9;
        int cz = cell / 9;
        return new Position(cx * 1350.0 + randomRange(0, 1350.0), cz * 1350.0 + randomRange(0, 1350.0));
    }

    private void leaveOtherRooms(String kommandantUUID, String exceptRoomId) {
        for (String roomId : mapper.selectActiveRoomIdsByCommander(kommandantUUID)) {
            if (exceptRoomId != null && exceptRoomId.equals(roomId)) {
                continue;
            }
            mapper.markRoomPlayerLeft(roomId, kommandantUUID);
            removePlayerModels(roomId, kommandantUUID);
            if (activePlayerCount(roomId) == 0) {
                mapper.closeRoom(roomId);
            }
        }
    }

    private void removePlayerModels(String roomId, String kommandantUUID) {
        for (String modelId : mapper.selectUBoatModelIdsByCommander(roomId, kommandantUUID)) {
            mapper.deleteTorpedoesByOwner(roomId, modelId);
        }
        mapper.deleteUBoatStatesByCommander(roomId, kommandantUUID);
    }

    private RoomDetail getRoomDetailObject(String roomId) {
        Map<String, Object> room = mapper.selectRoom(roomId);
        int playerAmount = activePlayerCount(roomId);
        int maxPlayers = integer(room, "max_players", "maxPlayers");
        return new RoomDetail(roomId, playerAmount, maxPlayers, status(playerAmount, maxPlayers), roomPlayers(roomId));
    }

    private Map<String, Object> roomJoinResponse(String message, String roomId) {
        return mapOf("sf", true, "message", message, "room", getRoomDetailObject(roomId));
    }

    private Optional<ConvoyInitial> convoyInitial(String roomId) {
        List<OnlineCargoShipState> ships = cargoShips(roomId);
        if (ships.isEmpty()) {
            return Optional.empty();
        }
        double centerX = ships.stream().mapToDouble(s -> s.location().x()).average().orElse(0.0);
        double centerZ = ships.stream().mapToDouble(s -> s.location().z()).average().orElse(0.0);
        OnlineCargoShipState first = ships.getFirst();
        Position center = new Position(centerX, centerZ);
        return Optional.of(new ConvoyInitial(roomId, locationCode(center), first.headingDegrees(), first.speedKnots(), center));
    }

    private void addConvoyInitialNotice(String roomId) {
        convoyInitial(roomId).ifPresent(c -> addNotice(roomId, "info",
                "BDU: 商船队位置：" + c.locationCode()
//                        + "，坐标：(" + c.location().x() + ", " + c.location().z() + ")"
                        + "，航向：" + c.headingDegrees()
                        + "，航速：" + c.speedKnots()));
    }

    private String locationCode(Position position) {
        double x = position.x();
        double z = position.z();
        if (x < 0 || x > MAP_SIZE || z < 0 || z > MAP_SIZE) {
            return "0_Out of Game Area";
        }
        x = Math.min(x, Math.nextDown(MAP_SIZE));
        z = Math.min(z, Math.nextDown(MAP_SIZE));
        return locationLevelCode(x, z, 4050.0, LOCATION_LEVEL_1_CODES)
                + locationLevelCode(x % 4050.0, z % 4050.0, 1350.0, LOCATION_LEVEL_CODES)
                + locationLevelCode(x % 1350.0, z % 1350.0, 450.0, LOCATION_LEVEL_CODES)
                + locationLevelCode(x % 450.0, z % 450.0, 150.0, LOCATION_LEVEL_CODES)
                + locationLevelCode(x % 150.0, z % 150.0, 50.0, LOCATION_LEVEL_CODES);
    }

    private String locationLevelCode(double x, double z, double cellSize, String[] codes) {
        int cellX = (int) Math.floor(x / cellSize);
        int cellZ = (int) Math.floor(z / cellSize);
        return codes[cellZ * 3 + cellX];
    }

    private List<RoomPlayer> roomPlayers(String roomId) {
        return mapper.selectRoomPlayers(roomId).stream()
                .map(row -> new RoomPlayer(
                        str(row, "kommandant_uuid", "kommandantUuid"),
                        str(row, "kommandant_name", "kommandantName"),
                        str(row, "uboat_id", "uboatId"),
                        isOnline(timestamp(row, "last_seen_at", "lastSeenAt"))))
                .toList();
    }

    private void moveCargoShips(String roomId) {
        for (OnlineCargoShipState ship : cargoShips(roomId)) {
            double radians = Math.toRadians(ship.headingDegrees());
            double gameUnitsPerTick = (ship.speedKnots() * 1852.0 * (1.0 / SCENE_TO_METERS) / 3600.0)
                    * WORLD_TICK_SECONDS;
            double dx = Math.sin(radians) * gameUnitsPerTick;
            double dz = -Math.cos(radians) * gameUnitsPerTick;
            mapper.updateCargoShipPosition(roomId, ship.modelID(), ship.location().x() + dx, ship.location().z() + dz);
        }
    }

    private void cleanupTorpedoes(String roomId) {
        int deleted = mapper.cleanupOldTorpedoes(roomId);
        System.out.println("【鱼雷清理】数据库清理过期鱼雷：roomId=" + roomId + "，deletedRows=" + deleted);
    }

    private void evaluateGameResult(String roomId) {
        if (gameResult(roomId).isPresent()) {
            System.out.println("【战局判定】房间已有游戏结果，跳过重复判定：roomId=" + roomId);
            return;
        }
        int sunk = sunkCargoCount(roomId);
        double ratio = sunk / (double) CARGO_COUNT;
        System.out.println("【战局判定】开始判定：roomId=" + roomId
                + "，击沉商船=" + sunk + "/" + CARGO_COUNT
                + "，仍有鱼雷玩家数=" + mapper.countActivePlayersWithTorpedoes(roomId)
                + "，地图活跃鱼雷数=" + mapper.countActiveTorpedoes(roomId)
                + "，活跃玩家数=" + activePlayerCount(roomId));
        if (sunk >= 16) {
            saveGameResult(roomId, "victory", "cargo_sunk_threshold", sunk, ratio);
            return;
        }
        if (cargoArrived(roomId)) {
            saveGameResult(roomId, "defeat", "cargo_arrived", sunk, ratio);
            return;
        }
        if (activePlayerCount(roomId) > 0 && allActivePlayersOutOfTorpedoes(roomId) && noActiveTorpedoesInWorld(roomId)) {
            System.out.println("【战局判定】所有有效玩家鱼雷已耗尽且地图无有效鱼雷，判定失败：roomId=" + roomId);
            saveGameResult(roomId, "defeat", "torpedoes_depleted", sunk, ratio);
            return;
        }
        if (activePlayerCount(roomId) > 0 && allActivePlayersSunk(roomId)) {
            saveGameResult(roomId, "defeat", "all_uboats_sunk", sunk, ratio);
        }
    }

    private void saveGameResult(String roomId, String state, String reason, int sunk, double ratio) {
        int inserted = mapper.insertGameResult(roomId, state, reason, sunk, CARGO_COUNT, ratio);
        System.out.println("【战局判定】数据库登记游戏结果：roomId=" + roomId
                + "，state=" + state
                + "，reason=" + reason
                + "，inserted=" + inserted
                + "，" + (inserted > 0 ? "登记成功" : "登记失败或已存在"));
        addNotice(roomId, "info", "战局结束：" + state);
    }

    private void updateAttackerSettlement(String roomId, String targetModelId) {
        List<Map<String, Object>> hits = mapper.selectHitSettlementSource(roomId, targetModelId);
        if (hits.isEmpty()) {
            System.out.println("【结算记录】未找到命中来源，跳过攻击者结算：roomId=" + roomId + "，targetModelID=" + targetModelId);
            return;
        }
        Map<String, Object> hit = hits.getFirst();
        String reporterUuid = str(hit, "reporter_uuid", "reporterUuid");
        String targetType = str(hit, "target_type", "targetType");
        if (reporterUuid == null || reporterUuid.isBlank()) {
            System.out.println("【结算记录】命中来源缺少上报玩家，跳过攻击者结算：roomId=" + roomId + "，targetModelID=" + targetModelId);
            return;
        }
        int cargoShipsSunk = "cargoShip".equals(targetType) ? 1 : 0;
        int uBoatsSunk = "uBoat".equals(targetType) ? 1 : 0;
        int tonnage = "cargoShip".equals(targetType) ? CARGO_TONNAGE : "uBoat".equals(targetType) ? U_BOAT_TONNAGE : 0;
        if (tonnage == 0) {
            System.out.println("【结算记录】未知目标类型，跳过攻击者结算：roomId=" + roomId
                    + "，targetModelID=" + targetModelId + "，targetType=" + targetType);
            return;
        }
        int updated = mapper.incrementSettlement(roomId, reporterUuid, cargoShipsSunk, uBoatsSunk, tonnage);
        System.out.println("【结算记录】数据库更新攻击者结算：roomId=" + roomId
                + "，kommandantUUID=" + reporterUuid
                + "，targetType=" + targetType
                + "，吨位增加=" + tonnage
                + "，updatedRows=" + updated
                + "，" + (updated > 0 ? "更新成功" : "更新失败"));
    }

    private void updateVictimSettlement(String roomId, String uboatModelId) {
        List<String> uuids = mapper.selectUBoatCommanderByModel(roomId, uboatModelId);
        if (!uuids.isEmpty()) {
            mapper.ensureSettlement(roomId, uuids.getFirst());
        }
    }

    private List<OnlineUBoatState> uboats(String roomId) {
        return mapper.selectWorldUBoats(roomId).stream().map(this::onlineUBoat).toList();
    }

    private List<OnlineCargoShipState> cargoShips(String roomId) {
        return mapper.selectWorldCargoShips(roomId).stream().map(this::onlineCargoShip).toList();
    }

    private List<OnlineTorpedoState> torpedoes(String roomId) {
        return mapper.selectWorldTorpedoes(roomId).stream().map(this::onlineTorpedo).toList();
    }

    private Optional<Settlement> settlementFor(String roomId, String uuid) {
        return mapper.selectSettlement(roomId, uuid).stream().findFirst()
                .map(row -> new Settlement(
                        str(row, "room_id", "roomId"),
                        str(row, "kommandant_uuid", "kommandantUuid"),
                        integer(row, "cargo_ships_sunk", "cargoShipsSunk"),
                        integer(row, "u_boats_sunk", "uBoatsSunk"),
                        integer(row, "total_tonnage", "totalTonnage")));
    }

    private Optional<GameResult> gameResult(String roomId) {
        return mapper.selectGameResult(roomId).stream().findFirst()
                .map(row -> new GameResult(
                        str(row, "room_id", "roomId"),
                        str(row, "state"),
                        str(row, "reason"),
                        integer(row, "cargo_ships_sunk", "cargoShipsSunk"),
                        integer(row, "total_cargo_ships", "totalCargoShips"),
                        dbl(row, "sunk_ratio", "sunkRatio")));
    }

    private PlayerGameRecord playerGameRecord(Map<String, Object> row) {
        return new PlayerGameRecord(
                str(row, "room_id", "roomId"),
                str(row, "state"),
                str(row, "reason"),
                integer(row, "cargo_ships_sunk", "cargoShipsSunk"),
                integer(row, "u_boats_sunk", "uBoatsSunk"),
                integer(row, "total_tonnage", "totalTonnage"),
                integer(row, "room_cargo_ships_sunk", "roomCargoShipsSunk"),
                integer(row, "total_cargo_ships", "totalCargoShips"),
                iso(row, "updated_at", "updatedAt"));
    }

    private Object lifecycleFor(String roomId, String modelId, String type) {
        Target t = target(roomId, modelId, type);
        if (t == null) {
            return null;
        }
        return new ModelLifecycle(t.modelId(), t.lifecycleState(), t.hitByModelId(), t.hitByKommandantUuid(),
                t.hitAt(), t.sunkAt());
    }

    private Target target(String roomId, String modelId, String type) {
        List<Map<String, Object>> rows = "cargoShip".equals(type)
                ? mapper.selectCargoTarget(roomId, modelId)
                : "uBoat".equals(type) ? mapper.selectUBoatTarget(roomId, modelId) : List.of();
        return rows.stream().findFirst().map(this::target).orElse(null);
    }

    private void addNotice(String roomId, String level, String content) {
        mapper.insertServerNotice(UUID.randomUUID().toString(), roomId, level, content);
    }

    private boolean cargoArrived(String roomId) {
        String side = mapper.selectConvoyStartSide(roomId);
        if ("left".equals(side)) {
            return mapper.countArrivedFromLeft(roomId, MAP_SIZE) > 0;
        }
        return mapper.countArrivedFromRight(roomId) > 0;
    }

    private boolean allActivePlayersOutOfTorpedoes(String roomId) {
        return mapper.countActivePlayersWithTorpedoes(roomId) == 0;
    }

    private boolean noActiveTorpedoesInWorld(String roomId) {
        return mapper.countActiveTorpedoes(roomId) == 0;
    }

    private boolean allActivePlayersSunk(String roomId) {
        return mapper.countActiveUnsunkUBoats(roomId) == 0;
    }

    private int sunkCargoCount(String roomId) {
        return mapper.countSunkCargo(roomId);
    }

    private void touchRoom(String roomId) {
        mapper.touchRoom(roomId);
    }

    private long roomRevision(String roomId) {
        Long revision = mapper.selectRoomRevision(roomId);
        return revision == null ? 0L : revision;
    }

    private boolean openRoomExists(String roomId) {
        return roomId != null && mapper.countOpenRoom(roomId) > 0;
    }

    private boolean isActiveRoomPlayer(String roomId, String uuid) {
        return roomId != null && uuid != null && mapper.countActiveRoomPlayer(roomId, uuid) > 0;
    }

    private boolean uboatOwnedBy(String roomId, String modelId, String uuid) {
        return mapper.countOwnedUBoat(roomId, modelId, uuid) > 0;
    }

    private int activePlayerCount(String roomId) {
        return mapper.countActivePlayers(roomId);
    }

    private RoomInfo roomInfo(Map<String, Object> row) {
        int players = integer(row, "player_amount", "playerAmount");
        int maxPlayers = integer(row, "max_players", "maxPlayers");
        return new RoomInfo(str(row, "room_id", "roomId"), players, maxPlayers, status(players, maxPlayers));
    }

    private String status(int players, int maxPlayers) {
        return players >= maxPlayers ? "full" : "joinable";
    }

    private boolean isOnline(Timestamp lastSeenAt) {
        return lastSeenAt != null && lastSeenAt.toInstant().isAfter(Instant.now().minusSeconds(10));
    }

    private AuthUser authUser(Map<String, Object> row) {
        return new AuthUser(
                str(row, "kommandant_uuid", "kommandantUuid"),
                str(row, "kommandant_name", "kommandantName"),
                str(row, "uboat_id", "uboatId"));
    }

    private TextMessage textMessage(Map<String, Object> row) {
        return new TextMessage(
                str(row, "message_id", "messageId"),
                str(row, "room_id", "roomId"),
                str(row, "sender_uuid", "senderUuid"),
                str(row, "sender_name", "senderName"),
                readStringList(str(row, "receiver_uuids", "receiverUuids")),
                str(row, "content"),
                iso(row, "created_at", "createdAt"));
    }

    private ServerNotice serverNotice(Map<String, Object> row) {
        return new ServerNotice(
                str(row, "notice_id", "noticeId"),
                str(row, "room_id", "roomId"),
                str(row, "level"),
                str(row, "content"),
                iso(row, "created_at", "createdAt"));
    }

    private OnlineUBoatState onlineUBoat(Map<String, Object> row) {
        return new OnlineUBoatState(
                str(row, "model_id", "modelId"),
                str(row, "lifecycle_state", "lifecycleState"),
                str(row, "hit_by_model_id", "hitByModelId"),
                str(row, "hit_by_kommandant_uuid", "hitByKommandantUuid"),
                iso(row, "hit_at", "hitAt"),
                iso(row, "sunk_at", "sunkAt"),
                str(row, "kommandant_uuid", "kommandantUuid"),
                str(row, "kommandant_name", "kommandantName"),
                str(row, "uboat_id", "uboatId"),
                dbl(row, "heading_degrees", "headingDegrees"),
                dbl(row, "speed_kmh", "speedKmh"),
                new Position(dbl(row, "location_x", "locationX"), dbl(row, "location_z", "locationZ")),
                dbl(row, "depth_meters", "depthMeters"),
                str(row, "navigation_state", "navigationState"),
                iso(row, "last_update_at", "lastUpdateAt"),
                integer(row, "torpedoes_remaining", "torpedoesRemaining"));
    }

    private OnlineCargoShipState onlineCargoShip(Map<String, Object> row) {
        return new OnlineCargoShipState(
                str(row, "model_id", "modelId"),
                str(row, "lifecycle_state", "lifecycleState"),
                str(row, "hit_by_model_id", "hitByModelId"),
                str(row, "hit_by_kommandant_uuid", "hitByKommandantUuid"),
                iso(row, "hit_at", "hitAt"),
                iso(row, "sunk_at", "sunkAt"),
                dbl(row, "heading_degrees", "headingDegrees"),
                dbl(row, "speed_knots", "speedKnots"),
                new Position(dbl(row, "location_x", "locationX"), dbl(row, "location_z", "locationZ")),
                dbl(row, "depth_meters", "depthMeters"),
                integerOrNull(row, "tonnage"),
                iso(row, "last_update_at", "lastUpdateAt"));
    }

    private OnlineTorpedoState onlineTorpedo(Map<String, Object> row) {
        return new OnlineTorpedoState(
                str(row, "model_id", "modelId"),
                str(row, "owner_model_id", "ownerModelId"),
                dbl(row, "heading_degrees", "headingDegrees"),
                dbl(row, "speed_knots", "speedKnots"),
                new Position(dbl(row, "location_x", "locationX"), dbl(row, "location_z", "locationZ")),
                dbl(row, "depth_meters", "depthMeters"),
                iso(row, "last_update_at", "lastUpdateAt"));
    }

    private Target target(Map<String, Object> row) {
        return new Target(
                str(row, "model_id", "modelId"),
                str(row, "lifecycle_state", "lifecycleState"),
                str(row, "hit_by_model_id", "hitByModelId"),
                str(row, "hit_by_kommandant_uuid", "hitByKommandantUuid"),
                iso(row, "hit_at", "hitAt"),
                iso(row, "sunk_at", "sunkAt"));
    }

    private List<String> readStringList(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<>() {
            });
        } catch (Exception ex) {
            return List.of();
        }
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            throw new IllegalArgumentException("JSON序列化失败", ex);
        }
    }

    private Timestamp parseTimestamp(String value, Instant fallback) {
        if (value == null || value.isBlank()) {
            return Timestamp.from(fallback);
        }
        try {
            return Timestamp.from(Instant.parse(value));
        } catch (Exception ex) {
            return Timestamp.from(fallback);
        }
    }

    private String iso(Map<String, Object> row, String... keys) {
        Timestamp timestamp = timestamp(row, keys);
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    private Timestamp timestamp(Map<String, Object> row, String... keys) {
        Object value = value(row, keys);
        if (value instanceof Timestamp timestamp) {
            return timestamp;
        }
        if (value instanceof java.util.Date date) {
            return new Timestamp(date.getTime());
        }
        return null;
    }

    private String str(Map<String, Object> row, String... keys) {
        Object value = value(row, keys);
        return value == null ? null : String.valueOf(value);
    }

    private int integer(Map<String, Object> row, String... keys) {
        Object value = value(row, keys);
        if (value instanceof Number number) {
            return number.intValue();
        }
        return value == null ? 0 : Integer.parseInt(String.valueOf(value));
    }

    private Integer integerOrNull(Map<String, Object> row, String... keys) {
        Object value = value(row, keys);
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.parseInt(String.valueOf(value));
    }

    private double dbl(Map<String, Object> row, String... keys) {
        Object value = value(row, keys);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return value == null ? 0.0 : Double.parseDouble(String.valueOf(value));
    }

    private Object value(Map<String, Object> row, String... keys) {
        for (String key : keys) {
            if (row.containsKey(key)) {
                return row.get(key);
            }
            String upper = key.toUpperCase(Locale.ROOT);
            if (row.containsKey(upper)) {
                return row.get(upper);
            }
        }
        return null;
    }

    private String trim(String value) {
        return value == null ? null : value.trim();
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private boolean randomBool() {
        return ThreadLocalRandom.current().nextBoolean();
    }

    private double randomRange(double min, double max) {
        return ThreadLocalRandom.current().nextDouble(min, max);
    }

    private double randomSigned(double maxAbs) {
        return ThreadLocalRandom.current().nextDouble(-maxAbs, maxAbs);
    }

    private int randomIntRange(int min, int max) {
        return ThreadLocalRandom.current().nextInt(min, max + 1);
    }

    private double randomConvoyHeading(String startSide) {
        if ("left".equals(startSide)) {
            int heading = randomIntRange(45, 135);
            return heading == 90 ? 91 : heading;
        }

        int heading = randomIntRange(225, 315);
        return heading == 270 ? 271 : heading;
    }

    private void shiftConvoyIntoMap(List<Position> positions, String startSide) {
        double minX = positions.stream().mapToDouble(Position::x).min().orElse(0.0);
        double maxX = positions.stream().mapToDouble(Position::x).max().orElse(0.0);
        double minZ = positions.stream().mapToDouble(Position::z).min().orElse(0.0);
        double maxZ = positions.stream().mapToDouble(Position::z).max().orElse(0.0);

        double shiftX = 0.0;
        if ("left".equals(startSide) && minX < 0.0) {
            shiftX = -minX;
        } else if ("right".equals(startSide) && maxX > MAP_SIZE) {
            shiftX = MAP_SIZE - maxX;
        } else if (minX < 0.0) {
            shiftX = -minX;
        } else if (maxX > MAP_SIZE) {
            shiftX = MAP_SIZE - maxX;
        }

        double shiftZ = 0.0;
        if (minZ < 0.0) {
            shiftZ = -minZ;
        } else if (maxZ > MAP_SIZE) {
            shiftZ = MAP_SIZE - maxZ;
        }

        for (int i = 0; i < positions.size(); i++) {
            Position position = positions.get(i);
            positions.set(i, new Position(position.x() + shiftX, position.z() + shiftZ));
        }
    }

    public static Map<String, Object> fail(String message) {
        return mapOf("sf", false, "message", message);
    }

    public static Map<String, Object> invalidTorpedo(String message, String code) {
        return mapOf(
                "sf", false,
                "message", message,
                "code", code,
                "torpedoAccepted", false,
                "restoreTorpedo", true
        );
    }

    public static Map<String, Object> mapOf(Object... values) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) {
            map.put((String) values[i], values[i + 1]);
        }
        return map;
    }

    private record Target(String modelId, String lifecycleState, String hitByModelId,
                          String hitByKommandantUuid, String hitAt, String sunkAt) {
    }
}
