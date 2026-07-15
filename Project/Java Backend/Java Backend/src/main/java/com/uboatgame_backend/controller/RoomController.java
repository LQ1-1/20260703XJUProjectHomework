package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.RoomCreateRequest;
import com.uboatgame_backend.dto.ApiDtos.RoomIdRequest;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/room")
@CrossOrigin(origins = "*")
public class RoomController {
    private final GameService gameService;

    public RoomController(GameService gameService) {
        this.gameService = gameService;
    }

    @GetMapping("/info")
    public Map<String, Object> info() {
        return gameService.roomInfo();
    }

    @PostMapping("/create")
    public Map<String, Object> create(HttpServletRequest request, @RequestBody RoomCreateRequest body) {
        return gameService.createRoom(user(request), body);
    }

    @PostMapping("/enter")
    public Map<String, Object> enter(HttpServletRequest request, @RequestBody RoomIdRequest body) {
        return gameService.enterRoom(user(request), body);
    }

    @GetMapping("/detail")
    public Map<String, Object> detail(@RequestParam String RoomID) {
        return gameService.roomDetail(RoomID);
    }

    @PostMapping("/leave")
    public Map<String, Object> leave(HttpServletRequest request, @RequestBody RoomIdRequest body) {
        return gameService.leaveRoom(user(request), body);
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }
}
