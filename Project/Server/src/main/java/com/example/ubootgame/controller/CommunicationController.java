package com.example.ubootgame.controller;

import com.example.ubootgame.dto.Communication;
import com.example.ubootgame.game.GameManager;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/communication")
public class CommunicationController {

    private final GameManager gameManager;

    public CommunicationController(GameManager gameManager) {
        this.gameManager = gameManager;
    }

    @PostMapping("/send")
    public Communication sendCommunication(@RequestBody Communication comm) {
        if (comm.getSenderUUID() == null || comm.getSenderUUID().isEmpty()) {
            throw new IllegalArgumentException("Sender UUID is required");
        }
        gameManager.sendCommunication(comm);
        comm.setTf(false);
        return comm;
    }

    @GetMapping("/receive")
    public List<Communication> receiveCommunication(@RequestParam String receiverUUID) {
        if (receiverUUID == null || receiverUUID.isEmpty()) {
            throw new IllegalArgumentException("Receiver UUID is required");
        }
        return gameManager.getCommunications(receiverUUID);
    }
}