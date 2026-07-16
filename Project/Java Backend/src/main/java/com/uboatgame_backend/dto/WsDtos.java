package com.uboatgame_backend.dto;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;

public final class WsDtos {
    private WsDtos() {
    }

    public record RoomWsTicket(String ticket, String RoomID, String expiresAt) {
    }

    public record RoomWsTicketResponse(boolean sf, String message, String ticket, String expiresAt) {
    }

    public record RoomTicketSession(String RoomID, AuthUser user, long expiresAtEpochMs) {
    }

    public record RoomEvent(String type, long seq, String roomId, long sentAt, Object payload) {
    }

    public record RoomError(String message, String code) {
    }
}
