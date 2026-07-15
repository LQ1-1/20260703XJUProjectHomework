package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.TextMessageRequest;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class CommunicationController {
    private static final Logger log = LoggerFactory.getLogger(CommunicationController.class);

    private final GameService gameService;

    public CommunicationController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/communication/send")
    public Map<String, Object> send(HttpServletRequest request, @RequestBody TextMessageRequest body) {
        AuthUser authUser = user(request);
        log.info("Send text message request received: kommandantUUID={}, roomID={}, receiverCount={}",
                userId(authUser),
                body == null ? null : body.RoomID(),
                body == null || body.receiverUUIDs() == null ? 0 : body.receiverUUIDs().size());
        return gameService.sendTextMessage(authUser, body);
    }

    @GetMapping("/communication/receive")
    public Map<String, Object> receive(HttpServletRequest request,
                                       @RequestParam String RoomID,
                                       @RequestParam(required = false) String after) {
        AuthUser authUser = user(request);
        log.info("Receive text messages request received: kommandantUUID={}, roomID={}, after={}",
                userId(authUser), RoomID, after);
        return gameService.receiveTextMessages(authUser, RoomID, after);
    }

    @GetMapping("/server/notice")
    public Map<String, Object> notices(HttpServletRequest request,
                                       @RequestParam String RoomID,
                                       @RequestParam(required = false) String after) {
        AuthUser authUser = user(request);
        log.info("Server notices request received: kommandantUUID={}, roomID={}, after={}",
                userId(authUser), RoomID, after);
        return gameService.serverNotices(authUser, RoomID, after);
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }

    private String userId(AuthUser user) {
        return user == null ? null : user.kommandantUUID();
    }
}
