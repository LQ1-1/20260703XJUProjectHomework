package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.LoginRequest;
import com.uboatgame_backend.dto.ApiDtos.RegistrationRequest;
import com.uboatgame_backend.service.GameService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final GameService gameService;

    public AuthController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/registration")
    public Map<String, Object> registration(@RequestBody RegistrationRequest request) {
        log.info("Registration request received: kommandantName={}, uBoatID={}",
                request == null ? null : request.KommandantName(),
                request == null ? null : request.UBoatID());
        return gameService.registration(request);
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody LoginRequest request) {
        log.info("Login request received: kommandantUUID={}",
                request == null ? null : request.KommandantUUID());
        return gameService.login(request);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        log.debug("Health check requested");
        return GameService.mapOf("sf", true, "message", "ok");
    }
}
