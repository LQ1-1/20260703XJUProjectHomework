package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.HitReportRequest;
import com.uboatgame_backend.dto.ApiDtos.SunkConfirmRequest;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/model")
@CrossOrigin(origins = "*")
public class ModelController {
    private static final Logger log = LoggerFactory.getLogger(ModelController.class);

    private final GameService gameService;

    public ModelController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/hit")
    public Map<String, Object> hit(HttpServletRequest request, @RequestBody HitReportRequest body) {
        AuthUser authUser = user(request);
        log.info("Hit report request received: kommandantUUID={}, roomID={}, attackerModelID={}, targetModelID={}, targetType={}, torpedoModelID={}",
                userId(authUser),
                body == null ? null : body.RoomID(),
                body == null ? null : body.attackerModelID(),
                body == null ? null : body.targetModelID(),
                body == null ? null : body.targetType(),
                body == null ? null : body.torpedoModelID());
        return gameService.reportHit(authUser, body);
    }

    @PostMapping("/sunk-confirm")
    public Map<String, Object> sunkConfirm(HttpServletRequest request, @RequestBody SunkConfirmRequest body) {
        AuthUser authUser = user(request);
        log.info("Sunk confirm request received: kommandantUUID={}, roomID={}, modelID={}, modelType={}",
                userId(authUser),
                body == null ? null : body.RoomID(),
                body == null ? null : body.modelID(),
                body == null ? null : body.modelType());
        return gameService.confirmSunk(authUser, body);
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }

    private String userId(AuthUser user) {
        return user == null ? null : user.kommandantUUID();
    }
}
