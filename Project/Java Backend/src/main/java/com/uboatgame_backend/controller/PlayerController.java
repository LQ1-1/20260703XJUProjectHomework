package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/player")
@CrossOrigin(origins = "*")
public class PlayerController {
    private static final Logger log = LoggerFactory.getLogger(PlayerController.class);

    private final GameService gameService;

    public PlayerController(GameService gameService) {
        this.gameService = gameService;
    }

    @GetMapping("/record")
    public Map<String, Object> record(HttpServletRequest request) {
        AuthUser authUser = (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
        log.info("Player record request received: kommandantUUID={}",
                authUser == null ? null : authUser.kommandantUUID());
        try {
            return gameService.playerRecord(authUser);
        } catch (Exception ex) {
            log.error("Player record request failed: kommandantUUID={}, errorClass={}, message={}",
                    authUser == null ? null : authUser.kommandantUUID(),
                    ex.getClass().getName(),
                    ex.getMessage(),
                    ex);
            return GameService.fail("战绩查询失败: " + ex.getClass().getSimpleName() + ": " + ex.getMessage());
        }
    }
}
