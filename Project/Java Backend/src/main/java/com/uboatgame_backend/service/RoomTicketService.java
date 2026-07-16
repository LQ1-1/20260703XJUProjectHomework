package com.uboatgame_backend.service;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.WsDtos.RoomTicketSession;
import com.uboatgame_backend.dto.WsDtos.RoomWsTicketResponse;
import com.uboatgame_backend.mapper.GameMapper;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Service
public class RoomTicketService {
    private static final Duration TICKET_TTL = Duration.ofSeconds(30);
    private static final String TICKET_PREFIX = "ws-ticket:";

    private final StringRedisTemplate redisTemplate;
    private final GameMapper mapper;
    private final ObjectMapper objectMapper;
    private final GameService gameService;
    private final RoomRuntimeService roomRuntimeService;

    public RoomTicketService(StringRedisTemplate redisTemplate, GameMapper mapper, ObjectMapper objectMapper,
                             GameService gameService, RoomRuntimeService roomRuntimeService) {
        this.redisTemplate = redisTemplate;
        this.mapper = mapper;
        this.objectMapper = objectMapper;
        this.gameService = gameService;
        this.roomRuntimeService = roomRuntimeService;
    }

    public RoomWsTicketResponse issueTicket(AuthUser user, String roomId) {
        if (user == null) {
            return new RoomWsTicketResponse(false, "未登录或登录已过期", null, null);
        }
        if (roomId == null || roomId.isBlank()) {
            return new RoomWsTicketResponse(false, "RoomID不能为空", null, null);
        }
        if (mapper.countActiveRoomPlayer(roomId, user.kommandantUUID()) <= 0) {
            return new RoomWsTicketResponse(false, "未加入该房间", null, null);
        }

        String ticket = UUID.randomUUID().toString().replace("-", "");
        long expiresAtEpochMs = Instant.now().plus(TICKET_TTL).toEpochMilli();
        RoomTicketSession session = new RoomTicketSession(roomId, user, expiresAtEpochMs);

        try {
            Map<String, Object> initialSnapshot = gameService.world(user, roomId);
            roomRuntimeService.writeInitialStateIfAbsent(roomId, initialSnapshot);
            redisTemplate.opsForValue().set(TICKET_PREFIX + ticket, objectMapper.writeValueAsString(session), TICKET_TTL);
        } catch (Exception ex) {
            return new RoomWsTicketResponse(false, "WebSocket ticket 签发失败", null, null);
        }

        return new RoomWsTicketResponse(true, "ticket签发成功", ticket, Instant.ofEpochMilli(expiresAtEpochMs).toString());
    }

    public Optional<RoomTicketSession> consumeTicket(String ticket) {
        if (ticket == null || ticket.isBlank()) {
            return Optional.empty();
        }

        String key = TICKET_PREFIX + ticket;
        String value = redisTemplate.opsForValue().get(key);
        redisTemplate.delete(key);
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }

        try {
            RoomTicketSession session = objectMapper.readValue(value, RoomTicketSession.class);
            if (session.expiresAtEpochMs() < Instant.now().toEpochMilli()) {
                return Optional.empty();
            }
            return Optional.of(session);
        } catch (Exception ex) {
            return Optional.empty();
        }
    }
}
