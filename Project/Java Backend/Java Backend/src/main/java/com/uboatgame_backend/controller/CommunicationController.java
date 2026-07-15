package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.TextMessageRequest;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class CommunicationController {
    private final GameService gameService;

    public CommunicationController(GameService gameService) {
        this.gameService = gameService;
    }

    @PostMapping("/communication/send")
    public Map<String, Object> send(HttpServletRequest request, @RequestBody TextMessageRequest body) {
        return gameService.sendTextMessage(user(request), body);
    }

    @GetMapping("/communication/receive")
    public Map<String, Object> receive(HttpServletRequest request,
                                       @RequestParam String RoomID,
                                       @RequestParam(required = false) String after) {
        return gameService.receiveTextMessages(user(request), RoomID, after);
    }

    @GetMapping("/server/notice")
    public Map<String, Object> notices(HttpServletRequest request,
                                       @RequestParam String RoomID,
                                       @RequestParam(required = false) String after) {
        return gameService.serverNotices(user(request), RoomID, after);
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }
}
