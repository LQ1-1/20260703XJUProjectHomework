package com.uboatgame_backend.dto;

import java.util.List;

public final class ApiDtos {
    private ApiDtos() {
    }

    public record AuthUser(String kommandantUUID, String kommandantName, String uBoatID) {
    }

    public record Position(double x, double z) {
    }

    public record LoginRequest(String KommandantUUID) {
    }

    public record RegistrationRequest(String KommandantName, String UBoatID) {
    }

    public record RoomCreateRequest(Integer maxPlayers, String roomName) {
    }

    public record RoomIdRequest(String RoomID) {
    }

    public record RoomInfo(String RoomID, int PlayerAmount, int maxPlayers, String status) {
    }

    public record RoomPlayer(String KommandantUUID, String KommandantName, String UBoatID, boolean online) {
    }

    public record RoomDetail(String RoomID, int PlayerAmount, int maxPlayers, String status, List<RoomPlayer> players) {
    }

    public record TextMessageRequest(String RoomID, List<String> receiverUUIDs, String content) {
    }

    public record TextMessage(String messageID, String RoomID, String senderUUID, String senderName,
                              List<String> receiverUUIDs, String content, String createdAt) {
    }

    public record ServerNotice(String noticeID, String RoomID, String level, String content, String createdAt) {
    }

    public record ModelLifecycle(String modelID, String lifecycleState, String hitByModelID,
                                 String hitByKommandantUUID, String hitAt, String sunkAt) {
    }

    public record OnlineUBoatState(String modelID, String lifecycleState, String hitByModelID,
                                   String hitByKommandantUUID, String hitAt, String sunkAt,
                                   String KommandantUUID, String KommandantName, String UBoatID,
                                   double headingDegrees, double speedKmh, Position location,
                                   double depthMeters, String navigationState, String lastUpdateAt,
                                   int torpedoesRemaining) {
    }

    public record OnlineCargoShipState(String modelID, String lifecycleState, String hitByModelID,
                                       String hitByKommandantUUID, String hitAt, String sunkAt,
                                       double headingDegrees, double speedKnots, Position location,
                                       double depthMeters, Integer tonnage, String lastUpdateAt) {
    }

    public record ConvoyInitial(String RoomID, String locationCode, double headingDegrees,
                                double speedKnots, Position location) {
    }

    public record OnlineTorpedoState(String modelID, String ownerModelID, double headingDegrees,
                                     double speedKnots, Position location, double depthMeters,
                                     String lastUpdateAt) {
    }

    public record WorldSyncRequest(String RoomID, OnlineUBoatState selfUBoat) {
    }

    public record TorpedoSyncRequest(String RoomID, OnlineTorpedoState torpedo) {
    }

    public record HitReportRequest(String RoomID, String attackerModelID, String targetModelID,
                                   String targetType, String torpedoModelID, String hitTime) {
    }

    public record SunkConfirmRequest(String RoomID, String modelID, String modelType, String sunkAt) {
    }

    public record Settlement(String RoomID, String KommandantUUID, int cargoShipsSunk, int totalTonnage) {
    }

    public record GameResult(String RoomID, String state, String reason, int cargoShipsSunk,
                             int totalCargoShips, double sunkRatio) {
    }
}
