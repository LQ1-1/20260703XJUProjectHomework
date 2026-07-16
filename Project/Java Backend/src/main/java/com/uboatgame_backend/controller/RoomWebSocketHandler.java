package com.uboatgame_backend.controller;

import com.uboatgame_backend.config.WebSocketAuthInterceptor;
import com.uboatgame_backend.dto.WsDtos.RoomError;
import com.uboatgame_backend.dto.WsDtos.RoomEvent;
import com.uboatgame_backend.dto.WsDtos.RoomTicketSession;
import com.uboatgame_backend.service.RoomBroadcastService;
import com.uboatgame_backend.service.RoomRuntimeService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.ObjectMapper;

@Component
public class RoomWebSocketHandler extends TextWebSocketHandler {
    private final RoomRuntimeService roomRuntimeService;
    private final RoomBroadcastService roomBroadcastService;
    private final ObjectMapper objectMapper;

    public RoomWebSocketHandler(RoomRuntimeService roomRuntimeService,
                                RoomBroadcastService roomBroadcastService,
                                ObjectMapper objectMapper) {
        this.roomRuntimeService = roomRuntimeService;
        this.roomBroadcastService = roomBroadcastService;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        RoomTicketSession roomSession = roomSession(session);
        if (roomSession == null) {
            closeQuietly(session, CloseStatus.NOT_ACCEPTABLE);
            return;
        }

        session.getAttributes().put("roomId", roomSession.RoomID());
        roomBroadcastService.register(roomSession.RoomID(), session);
        send(session, new RoomEvent(
                "room.joined",
                0,
                roomSession.RoomID(),
                System.currentTimeMillis(),
                roomSession
        ));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        RoomTicketSession roomSession = roomSession(session);
        if (roomSession == null) {
            sendError(session, null, "未认证的 WebSocket 会话", "UNAUTHENTICATED");
            return;
        }

        RoomEvent event;
        try {
            event = objectMapper.readValue(message.getPayload(), RoomEvent.class);
        } catch (Exception ex) {
            sendError(session, roomSession.RoomID(), "WebSocket 事件格式错误", "BAD_EVENT");
            return;
        }

        if (!roomSession.RoomID().equals(event.roomId())) {
            sendError(session, roomSession.RoomID(), "事件房间与连接房间不一致", "ROOM_MISMATCH");
            return;
        }

        if ("ping".equals(event.type())) {
            send(session, new RoomEvent("pong", event.seq(), roomSession.RoomID(), System.currentTimeMillis(), event.payload()));
            return;
        }

        roomRuntimeService.appendEvent(roomSession.RoomID(), event);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Object roomId = session.getAttributes().get("roomId");
        if (roomId instanceof String value) {
            roomBroadcastService.unregister(value, session);
        }
    }

    private RoomTicketSession roomSession(WebSocketSession session) {
        Object value = session.getAttributes().get(WebSocketAuthInterceptor.ROOM_SESSION_ATTR);
        return value instanceof RoomTicketSession roomSession ? roomSession : null;
    }

    private void sendError(WebSocketSession session, String roomId, String message, String code) {
        send(session, new RoomEvent(
                "error",
                0,
                roomId == null ? "" : roomId,
                System.currentTimeMillis(),
                new RoomError(message, code)
        ));
    }

    private void send(WebSocketSession session, RoomEvent event) {
        if (!session.isOpen()) return;
        try {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(event)));
        } catch (Exception ignored) {
        }
    }

    private void closeQuietly(WebSocketSession session, CloseStatus status) {
        try {
            session.close(status);
        } catch (Exception ignored) {
        }
    }
}
