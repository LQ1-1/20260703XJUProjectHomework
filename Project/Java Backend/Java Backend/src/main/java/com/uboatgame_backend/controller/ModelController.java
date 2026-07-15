package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.HitReportRequest;
import com.uboatgame_backend.dto.ApiDtos.SunkConfirmRequest;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/model")
@CrossOrigin(origins = "*")
public class ModelController {
    private final GameService gameService;

    public ModelController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/hit")
    public Map<String, Object> hit(HttpServletRequest request, @RequestBody HitReportRequest body) {
        return gameService.reportHit(user(request), body);
    }

    @PostMapping("/sunk-confirm")
    public Map<String, Object> sunkConfirm(HttpServletRequest request, @RequestBody SunkConfirmRequest body) {
        return gameService.confirmSunk(user(request), body);
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }
}
