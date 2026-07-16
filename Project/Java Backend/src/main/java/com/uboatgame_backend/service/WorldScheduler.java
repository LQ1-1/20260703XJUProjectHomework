package com.uboatgame_backend.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class WorldScheduler {
    private final GameService gameService;

    public WorldScheduler(GameService gameService) {
        this.gameService = gameService;
    }

    @Scheduled(fixedDelay = 500)
    public void tick() {
        gameService.tickWorld();
    }
}
