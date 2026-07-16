package com.uboatgame_backend.service;

import com.uboatgame_backend.dto.WsDtos.RoomEvent;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomBroadcastService {
    private final ObjectMapper objectMapper;
    private final ConcurrentHashMap<String, Set<WebSocketSession>> roomSessions = new ConcurrentHashMap<>();

    public RoomBroadcastService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void register(String roomId, WebSocketSession session) {
        roomSessions.computeIfAbsent(roomId, ignored -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void unregister(String roomId, WebSocketSession session) {
        Set<WebSocketSession> sessions = roomSessions.get(roomId);
        if (sessions == null) return;
        sessions.remove(session);
        if (sessions.isEmpty()) {
            roomSessions.remove(roomId);
        }
    }

    public void broadcast(String roomId, RoomEvent event) {
        Set<WebSocketSession> sessions = roomSessions.get(roomId);
        if (sessions == null || sessions.isEmpty()) return;

        String payload;
        try {
            payload = objectMapper.writeValueAsString(event);
        } catch (Exception ex) {
            return;
        }

        TextMessage message = new TextMessage(payload);
        for (WebSocketSession session : sessions) {
            if (!session.isOpen()) continue;
            try {
                session.sendMessage(message);
            } catch (IOException ignored) {
                // Closed sessions are removed on afterConnectionClosed.
            }
        }
    }
}
