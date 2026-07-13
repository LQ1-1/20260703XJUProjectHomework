package com.example.ubootgame.controller;

import com.example.ubootgame.dto.LoginRequest;
import com.example.ubootgame.dto.LoginResponse;
import com.example.ubootgame.game.GameManager;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final GameManager gameManager;

    public AuthController(GameManager gameManager) {
        this.gameManager = gameManager;
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest request) {
        if (request.getUsername() == null || request.getUsername().isEmpty()) {
            throw new IllegalArgumentException("Username is required");
        }
        return gameManager.login(request.getUsername());
    }

    @PostMapping("/logout")
    public Map<String, Boolean> logout(@RequestBody Map<String, String> body) {
        String uuid = body.get("uuid");
        if (uuid == null || uuid.isEmpty()) {
            throw new IllegalArgumentException("UUID is required");
        }
        gameManager.logout(uuid);
        return Map.of("success", true);
    }
}