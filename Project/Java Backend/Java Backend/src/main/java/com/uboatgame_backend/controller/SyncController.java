package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.TorpedoSyncRequest;
import com.uboatgame_backend.dto.ApiDtos.WorldSyncRequest;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/sync")
@CrossOrigin(origins = "*")
public class SyncController {
    private final GameService gameService;

    public SyncController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/uboat")
    public Map<String, Object> uboat(HttpServletRequest request, @RequestBody WorldSyncRequest body) {
        return gameService.syncUBoat(user(request), body);
    }

    @PostMapping("/torpedo")
    public Map<String, Object> torpedo(HttpServletRequest request, @RequestBody TorpedoSyncRequest body) {
        return gameService.syncTorpedo(user(request), body);
    }

    @GetMapping("/world")
    public Map<String, Object> world(HttpServletRequest request,
                                     @RequestParam String RoomID,
                                     @RequestParam(required = false) String after) {
        return gameService.world(user(request), RoomID);
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }
}
