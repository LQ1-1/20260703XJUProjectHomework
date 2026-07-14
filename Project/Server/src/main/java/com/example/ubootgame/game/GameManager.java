package com.example.ubootgame.game;

import com.example.ubootgame.dto.*;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Component
public class GameManager {

    private static final double GAME_AREA_SIZE = 12150;
    private static final double MIN_PLAYER_DISTANCE = 4050;
    private static final int CARGO_SHIP_COUNT = 22;
    private static final int CARGO_ROWS = 4;
    private static final int CARGO_COLS = 5;
    private static final double CARGO_HORIZONTAL_SPACING = 261;
    private static final double CARGO_VERTICAL_SPACING = 160;
    private static final double CARGO_DEVIATION = 50;
    private static final double CARGO_SPEED = 7;

    private final Map<String, UBoatInfo> players = new ConcurrentHashMap<>();
    private final Map<String, CargoshipInfo> cargoShips = new ConcurrentHashMap<>();
    private final List<HitRecordShip> hitRecords = new CopyOnWriteArrayList<>();
    private final Map<String, Integer> tonnageRecords = new ConcurrentHashMap<>();
    private final List<Communication> communications = new CopyOnWriteArrayList<>();

    private double cargoHeading;
    private double cargoDirectionX;
    private double cargoDirectionZ;

    @PostConstruct
    public void init() {
        generateCargoShips();
        startGameLoop();
    }

    private double randomRange(double min, double max) {
        return Math.random() * (max - min) + min;
    }

    private Position randomPosition() {
        return new Position(
                randomRange(1000, GAME_AREA_SIZE - 1000),
                randomRange(1000, GAME_AREA_SIZE - 1000)
        );
    }

    private double distance(Position pos1, Position pos2) {
        double dx = pos1.getX() - pos2.getX();
        double dz = pos1.getZ() - pos2.getZ();
        return Math.sqrt(dx * dx + dz * dz);
    }

    private void generateCargoShips() {
        cargoHeading = randomRange(0, 360);
        double angle = Math.toRadians(cargoHeading);
        cargoDirectionX = Math.sin(angle);
        cargoDirectionZ = -Math.cos(angle);

        double convoyCenterX = GAME_AREA_SIZE / 2;
        double convoyCenterZ = GAME_AREA_SIZE / 2;

        int shipIndex = 0;
        for (int row = 0; row < CARGO_ROWS; row++) {
            for (int col = 0; col < CARGO_COLS; col++) {
                if (shipIndex >= CARGO_SHIP_COUNT) break;

                double baseX = convoyCenterX + (col - CARGO_COLS / 2.0 + 0.5) * CARGO_HORIZONTAL_SPACING;
                double baseZ = convoyCenterZ + (row - CARGO_ROWS / 2.0 + 0.5) * CARGO_VERTICAL_SPACING;

                double deviationX = randomRange(-CARGO_DEVIATION, CARGO_DEVIATION);
                double deviationZ = randomRange(-CARGO_DEVIATION, CARGO_DEVIATION);

                CargoshipInfo ship = new CargoshipInfo();
                ship.setId(UUID.randomUUID().toString());
                ship.setHeadingDegrees(cargoHeading);
                ship.setSpeed(CARGO_SPEED);
                ship.setLocation(new Position(baseX + deviationX, baseZ + deviationZ));
                ship.setDepth(0);
                ship.setDestroyed(false);

                cargoShips.put(ship.getId(), ship);
                shipIndex++;
            }
        }

        while (shipIndex < CARGO_SHIP_COUNT) {
            double deviationX = randomRange(-CARGO_DEVIATION * 2, CARGO_DEVIATION * 2);
            double deviationZ = randomRange(-CARGO_DEVIATION * 2, CARGO_DEVIATION * 2);

            CargoshipInfo ship = new CargoshipInfo();
            ship.setId(UUID.randomUUID().toString());
            ship.setHeadingDegrees(cargoHeading);
            ship.setSpeed(CARGO_SPEED);
            ship.setLocation(new Position(convoyCenterX + deviationX, convoyCenterZ + deviationZ));
            ship.setDepth(0);
            ship.setDestroyed(false);

            cargoShips.put(ship.getId(), ship);
            shipIndex++;
        }
    }

    private void updateCargoShips() {
        double speedPerUpdate = CARGO_SPEED * 0.15;

        for (CargoshipInfo ship : cargoShips.values()) {
            if (ship.isDestroyed()) continue;

            Position loc = ship.getLocation();
            loc.setX(loc.getX() + cargoDirectionX * speedPerUpdate);
            loc.setZ(loc.getZ() + cargoDirectionZ * speedPerUpdate);

            if (loc.getX() < 0 || loc.getX() > GAME_AREA_SIZE ||
                    loc.getZ() < 0 || loc.getZ() > GAME_AREA_SIZE) {
                respawnCargoShip(ship);
            }
        }
    }

    private void respawnCargoShip(CargoshipInfo ship) {
        int side = (int) randomRange(0, 4);
        double x, z;

        switch (side) {
            case 0:
                x = randomRange(0, GAME_AREA_SIZE);
                z = -1000;
                break;
            case 1:
                x = GAME_AREA_SIZE + 1000;
                z = randomRange(0, GAME_AREA_SIZE);
                break;
            case 2:
                x = randomRange(0, GAME_AREA_SIZE);
                z = GAME_AREA_SIZE + 1000;
                break;
            default:
                x = -1000;
                z = randomRange(0, GAME_AREA_SIZE);
        }

        ship.setLocation(new Position(x, z));
        ship.setDestroyed(false);
    }

    private void startGameLoop() {
        Timer timer = new Timer();
        timer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                updateCargoShips();
            }
        }, 0, 150);
    }

    public LoginResponse login(String username) {
        String uuid = UUID.randomUUID().toString();
        Position position = randomPosition();

        while (true) {
            boolean tooClose = false;
            for (UBoatInfo player : players.values()) {
                if (distance(position, player.getLocation()) < MIN_PLAYER_DISTANCE) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) break;
            position = randomPosition();
        }

        double heading = randomRange(0, 360);

        UBoatInfo player = new UBoatInfo();
        player.setId(uuid);
        player.setUsername(username);
        player.setHeadingDegrees(heading);
        player.setSpeed(0);
        player.setLocation(position);
        player.setDepth(0);
        player.setTorpedoCount(14);

        players.put(uuid, player);

        return new LoginResponse(uuid, username, position, heading, new ArrayList<>(cargoShips.values()));
    }

    public void logout(String uuid) {
        players.remove(uuid);
    }

    public List<CargoshipInfo> getConvoy() {
        return new ArrayList<>(cargoShips.values());
    }

    public List<UBoatInfo> getWolfpack() {
        return new ArrayList<>(players.values());
    }

    public void updateUBoatInfo(String uuid, UBoatInfo info) {
        UBoatInfo player = players.get(uuid);
        if (player != null) {
            if (info.getHeadingDegrees() > 0) player.setHeadingDegrees(info.getHeadingDegrees());
            if (info.getSpeed() > 0) player.setSpeed(info.getSpeed());
            if (info.getLocation() != null) player.setLocation(info.getLocation());
            if (info.getDepth() > 0) player.setDepth(info.getDepth());
            if (info.getTorpedoCount() > 0) player.setTorpedoCount(info.getTorpedoCount());
        }
    }

    public void addHitRecord(String senderUUID, String targetUUID) {
        HitRecordShip record = new HitRecordShip();
        record.setSenderUUID(senderUUID);
        record.setTargetUUID(targetUUID);
        record.setTime(java.time.Instant.now().toString());
        hitRecords.add(record);

        CargoshipInfo cargo = cargoShips.get(targetUUID);
        if (cargo != null) {
            cargo.setDestroyed(true);
        }

        int currentTonnage = tonnageRecords.getOrDefault(senderUUID, 0);
        tonnageRecords.put(senderUUID, currentTonnage + 7000);
    }

    public List<HitRecordShip> getHitRecordsShips() {
        return hitRecords;
    }

    public List<HitRecordTonnage> getHitRecordsTonnages() {
        List<HitRecordTonnage> result = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : tonnageRecords.entrySet()) {
            result.add(new HitRecordTonnage(entry.getKey(), entry.getValue()));
        }
        return result;
    }

    public void sendCommunication(Communication comm) {
        communications.add(comm);
    }

    public List<Communication> getCommunications(String receiverUUID) {
        List<Communication> result = new ArrayList<>();
        for (Communication comm : communications) {
            if (receiverUUID.equals(comm.getReceiverUUID())) {
                result.add(comm);
            }
        }
        return result;
    }

    public UBoatInfo getPlayerByUUID(String uuid) {
        return players.get(uuid);
    }

    public UBoatInfo getPlayerByUsername(String username) {
        for (UBoatInfo player : players.values()) {
            if (username.equals(player.getUsername())) {
                return player;
            }
        }
        return null;
    }

    public int getPlayerCount() {
        return players.size();
    }
}