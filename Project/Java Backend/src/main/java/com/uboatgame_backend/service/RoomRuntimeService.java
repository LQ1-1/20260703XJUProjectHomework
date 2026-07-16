package com.uboatgame_backend.service;

import com.uboatgame_backend.dto.WsDtos.RoomEvent;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class RoomRuntimeService {
    public static final Duration ACTIVE_ROOM_TTL = Duration.ofMinutes(30);
    public static final Duration ROOM_TICK_LOCK_TTL = Duration.ofMillis(800);

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    public RoomRuntimeService(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
    }

    public void appendEvent(String roomId, RoomEvent event) {
        try {
            redisTemplate.opsForList().rightPush(eventsKey(roomId), objectMapper.writeValueAsString(event));
            redisTemplate.expire(eventsKey(roomId), ACTIVE_ROOM_TTL);
        } catch (Exception ignored) {
        }
    }

    public List<RoomEvent> drainEvents(String roomId) {
        String key = eventsKey(roomId);
        List<String> rawEvents = redisTemplate.opsForList().range(key, 0, -1);
        redisTemplate.delete(key);
        if (rawEvents == null || rawEvents.isEmpty()) {
            return List.of();
        }

        List<RoomEvent> events = new ArrayList<>();
        for (String rawEvent : rawEvents) {
            try {
                events.add(objectMapper.readValue(rawEvent, RoomEvent.class));
            } catch (Exception ignored) {
            }
        }
        return events;
    }

    public Set<String> activeRoomStateKeys() {
        Set<String> keys = redisTemplate.keys("room:*:state");
        return keys == null ? Set.of() : keys;
    }

    public boolean acquireTickLock(String roomId) {
        Boolean acquired = redisTemplate.opsForValue().setIfAbsent(lockKey(roomId), "1", ROOM_TICK_LOCK_TTL);
        return Boolean.TRUE.equals(acquired);
    }

    public void refreshRoomTtl(String roomId) {
        redisTemplate.expire(stateKey(roomId), ACTIVE_ROOM_TTL);
        redisTemplate.expire(playersKey(roomId), ACTIVE_ROOM_TTL);
    }

    public void writeInitialStateIfAbsent(String roomId, Map<String, Object> snapshot) {
        try {
            redisTemplate.opsForValue().setIfAbsent(stateKey(roomId), objectMapper.writeValueAsString(snapshot), ACTIVE_ROOM_TTL);
        } catch (Exception ignored) {
        }
    }

    public Object readStatePayload(String roomId) {
        String value = redisTemplate.opsForValue().get(stateKey(roomId));
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(value, Object.class);
        } catch (Exception ex) {
            return null;
        }
    }

    public String roomIdFromStateKey(String stateKey) {
        if (stateKey == null || !stateKey.startsWith("room:") || !stateKey.endsWith(":state")) {
            return null;
        }
        return stateKey.substring("room:".length(), stateKey.length() - ":state".length());
    }

    public String stateKey(String roomId) {
        return "room:" + roomId + ":state";
    }

    public String eventsKey(String roomId) {
        return "room:" + roomId + ":events";
    }

    public String playersKey(String roomId) {
        return "room:" + roomId + ":players";
    }

    public String lockKey(String roomId) {
        return "room:" + roomId + ":lock";
    }
}
