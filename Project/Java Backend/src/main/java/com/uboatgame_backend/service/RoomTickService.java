package com.uboatgame_backend.service;

import com.uboatgame_backend.dto.WsDtos.RoomEvent;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class RoomTickService {
    private static final long TICK_INTERVAL_MS = 500L;

    private final RoomRuntimeService roomRuntimeService;
    private final RoomBroadcastService roomBroadcastService;

    public RoomTickService(RoomRuntimeService roomRuntimeService, RoomBroadcastService roomBroadcastService) {
        this.roomRuntimeService = roomRuntimeService;
        this.roomBroadcastService = roomBroadcastService;
    }

    @Scheduled(fixedDelay = TICK_INTERVAL_MS)
    public void tickRooms() {
        for (String stateKey : roomRuntimeService.activeRoomStateKeys()) {
            String roomId = roomRuntimeService.roomIdFromStateKey(stateKey);
            if (roomId == null || !roomRuntimeService.acquireTickLock(roomId)) {
                continue;
            }
            tickRoom(roomId);
        }
    }

    private void tickRoom(String roomId) {
        List<RoomEvent> events = roomRuntimeService.drainEvents(roomId);
        roomRuntimeService.refreshRoomTtl(roomId);

        if (!events.isEmpty()) {
            roomBroadcastService.broadcast(roomId, new RoomEvent(
                    "world.events",
                    0,
                    roomId,
                    System.currentTimeMillis(),
                    events
            ));
        }

        Object snapshot = roomRuntimeService.readStatePayload(roomId);
        if (snapshot != null) {
            roomBroadcastService.broadcast(roomId, new RoomEvent(
                    "world.snapshot",
                    0,
                    roomId,
                    System.currentTimeMillis(),
                    snapshot
            ));
        }

        // TODO: Advance authoritative Redis world state before broadcasting:
        // cargo movement, torpedo lifecycle, hit verification, sinking timeout,
        // correction generation, and settlement persistence.
    }
}
