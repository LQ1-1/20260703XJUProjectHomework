package com.example.ubootgame.controller;

import com.example.ubootgame.game.GameManager;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController {

    private final GameManager gameManager;

    public HealthController(GameManager gameManager) {
        this.gameManager = gameManager;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "players", gameManager.getPlayerCount());
    }
}