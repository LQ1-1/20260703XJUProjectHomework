package com.uboatgame_backend.controller;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.dto.ApiDtos.RoomCreateRequest;
import com.uboatgame_backend.dto.ApiDtos.RoomIdRequest;
import com.uboatgame_backend.dto.WsDtos.RoomWsTicketResponse;
import com.uboatgame_backend.service.GameService;
import com.uboatgame_backend.service.RoomTicketService;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/room")
@CrossOrigin(origins = "*")
public class RoomController {
    private static final Logger log = LoggerFactory.getLogger(RoomController.class);

    private final GameService gameService;
    private final RoomTicketService roomTicketService;

    public RoomController(GameService gameService, RoomTicketService roomTicketService) {
        this.gameService = gameService;
        this.roomTicketService = roomTicketService;
    }

    @GetMapping("/info")
    public Map<String, Object> info() {
        log.info("Room info request received");
        return gameService.roomInfo();
    }

    @PostMapping("/create")
    public Map<String, Object> create(HttpServletRequest request, @RequestBody RoomCreateRequest body) {
        AuthUser authUser = user(request);
        log.info("Create room request received: kommandantUUID={}, roomName={}, maxPlayers={}",
                userId(authUser),
                body == null ? null : body.roomName(),
                body == null ? null : body.maxPlayers());
        return gameService.createRoom(authUser, body);
    }

    @PostMapping("/enter")
    public Map<String, Object> enter(HttpServletRequest request, @RequestBody RoomIdRequest body) {
        AuthUser authUser = user(request);
        log.info("Enter room request received: kommandantUUID={}, roomID={}",
                userId(authUser),
                body == null ? null : body.RoomID());
        return gameService.enterRoom(authUser, body);
    }

    @GetMapping("/detail")
    public Map<String, Object> detail(@RequestParam String RoomID) {
        log.info("Room detail request received: roomID={}", RoomID);
        return gameService.roomDetail(RoomID);
    }

    @PostMapping("/leave")
    public Map<String, Object> leave(HttpServletRequest request, @RequestBody RoomIdRequest body) {
        AuthUser authUser = user(request);
        log.info("Leave room request received: kommandantUUID={}, roomID={}",
                userId(authUser),
                body == null ? null : body.RoomID());
        return gameService.leaveRoom(authUser, body);
    }

    @PostMapping("/ws-ticket")
    public RoomWsTicketResponse wsTicket(HttpServletRequest request, @RequestBody RoomIdRequest body) {
        AuthUser authUser = user(request);
        log.info("WebSocket ticket request received: kommandantUUID={}, roomID={}",
                userId(authUser),
                body == null ? null : body.RoomID());
        return roomTicketService.issueTicket(authUser, body == null ? null : body.RoomID());
    }

    private AuthUser user(HttpServletRequest request) {
        return (AuthUser) request.getAttribute(GameService.AUTH_ATTR);
    }

    private String userId(AuthUser user) {
        return user == null ? null : user.kommandantUUID();
    }
}
