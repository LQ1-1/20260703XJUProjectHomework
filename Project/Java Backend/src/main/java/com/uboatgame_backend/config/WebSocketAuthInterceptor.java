package com.uboatgame_backend.config;

import com.uboatgame_backend.dto.WsDtos.RoomTicketSession;
import com.uboatgame_backend.service.RoomTicketService;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;

@Component
public class WebSocketAuthInterceptor implements HandshakeInterceptor {
    public static final String ROOM_SESSION_ATTR = "roomTicketSession";

    private final RoomTicketService roomTicketService;

    public WebSocketAuthInterceptor(RoomTicketService roomTicketService) {
        this.roomTicketService = roomTicketService;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        Optional<RoomTicketSession> session = roomTicketService.consumeTicket(ticketFrom(request.getURI()));
        session.ifPresent(value -> attributes.put(ROOM_SESSION_ATTR, value));
        return session.isPresent();
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
    }

    private String ticketFrom(URI uri) {
        String query = uri.getRawQuery();
        if (query == null || query.isBlank()) {
            return null;
        }
        for (String part : query.split("&")) {
            int splitAt = part.indexOf('=');
            if (splitAt <= 0) continue;
            String key = URLDecoder.decode(part.substring(0, splitAt), StandardCharsets.UTF_8);
            if (!"ticket".equals(key)) continue;
            return URLDecoder.decode(part.substring(splitAt + 1), StandardCharsets.UTF_8);
        }
        return null;
    }
}
