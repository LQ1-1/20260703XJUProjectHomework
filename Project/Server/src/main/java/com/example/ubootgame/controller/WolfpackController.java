package com.example.ubootgame.controller;

import com.example.ubootgame.dto.UBoatInfo;
import com.example.ubootgame.dto.WolfpackDetailInfo;
import com.example.ubootgame.game.GameManager;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/wolfpack")
public class WolfpackController {

    private final GameManager gameManager;

    public WolfpackController(GameManager gameManager) {
        this.gameManager = gameManager;
    }

    @GetMapping("/infos")
    public WolfpackDetailInfo getWolfpackInfos() {
        return new WolfpackDetailInfo(false, gameManager.getWolfpack());
    }

    @PostMapping("/upload")
    public Map<String, Boolean> uploadUBoatInfo(@RequestBody UBoatInfo info) {
        if (info.getId() == null || info.getId().isEmpty()) {
            throw new IllegalArgumentException("UUID is required");
        }
        gameManager.updateUBoatInfo(info.getId(), info);
        return Map.of("success", true);
    }
}