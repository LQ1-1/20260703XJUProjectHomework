package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.TorpedoSyncRequest;
import com.uboatgame_backend.dto.ApiDtos.WorldSyncRequest;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/sync")
@CrossOrigin(origins = "*")
public class SyncController {
    private static final Logger log = LoggerFactory.getLogger(SyncController.class);

    private final GameService gameService;

    public SyncController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/uboat")
    public Map<String, Object> uboat(HttpServletRequest request, @RequestBody WorldSyncRequest body) {
        AuthUser authUser = user(request);
        log.debug("U-Boat sync request received: kommandantUUID={}, roomID={}, modelID={}",
                userId(authUser),
                body == null ? null : body.RoomID(),
                body == null || body.selfUBoat() == null ? null : body.selfUBoat().modelID());
        return gameService.syncUBoat(authUser, body);
    }

    @PostMapping("/torpedo")
    public Map<String, Object> torpedo(HttpServletRequest request, @RequestBody TorpedoSyncRequest body) {
        AuthUser authUser = user(request);
        log.debug("Torpedo sync request received: kommandantUUID={}, roomID={}, modelID={}, ownerModelID={}",
                userId(authUser),
                body == null ? null : body.RoomID(),
                body == null || body.torpedo() == null ? null : body.torpedo().modelID(),
                body == null || body.torpedo() == null ? null : body.torpedo().ownerModelID());
        return gameService.syncTorpedo(authUser, body);
    }

    @GetMapping("/world")
    public Map<String, Object> world(HttpServletRequest request,
                                     @RequestParam String RoomID,
                                     @RequestParam(required = false) String after) {
        AuthUser authUser = user(request);
        log.debug("World sync request received: kommandantUUID={}, roomID={}, after={}",
                userId(authUser), RoomID, after);
        return gameService.world(authUser, RoomID);
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }

    private String userId(AuthUser user) {
        return user == null ? null : user.kommandantUUID();
    }
}
