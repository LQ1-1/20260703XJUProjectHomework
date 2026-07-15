package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.LoginRequest;
import com.uboatgame_backend.dto.ApiDtos.RegistrationRequest;
import com.uboatgame_backend.service.GameService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class AuthController {
    private final GameService gameService;

    public AuthController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/registration")
    public Map<String, Object> registration(@RequestBody RegistrationRequest request) {
        return gameService.registration(request);
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody LoginRequest request) {
        return gameService.login(request);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return GameService.mapOf("sf", true, "message", "ok");
    }
}
