package com.uboatgame_backend.service;

import com.uboatgame_backend.mapper.GameMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.function.Supplier;

@Service
public class DatabaseAccess {
    private static final int ROOM_WRITE_LOCK_TIMEOUT_SECONDS = 3;

    private final GameMapper mapper;

    public DatabaseAccess(GameMapper mapper) {
        this.mapper = mapper;
    }

    public <T> T withRoomWriteLock(String roomId, Supplier<T> action) {
        if (roomId == null || roomId.isBlank()) {
            return action.get();
        }

        Integer acquired = mapper.acquireRoomWriteLock(roomId, ROOM_WRITE_LOCK_TIMEOUT_SECONDS);
        if (acquired == null || acquired != 1) {
            throw new IllegalStateException("获取房间数据库写锁失败: " + roomId);
        }

        try {
            return action.get();
        } finally {
            releaseRoomWriteLockAfterTransaction(roomId);
        }
    }

    public void withRoomWriteLock(String roomId, Runnable action) {
        withRoomWriteLock(roomId, () -> {
            action.run();
            return null;
        });
    }

    private void releaseRoomWriteLockAfterTransaction(String roomId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            mapper.releaseRoomWriteLock(roomId);
            return;
        }

        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                mapper.releaseRoomWriteLock(roomId);
            }
        });
    }
}
