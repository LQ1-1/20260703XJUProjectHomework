package com.example.ubootgame.controller;

import com.example.ubootgame.dto.ConvoyDetailInfo;
import com.example.ubootgame.game.GameManager;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/convoy")
public class ConvoyController {

    private final GameManager gameManager;

    public ConvoyController(GameManager gameManager) {
        this.gameManager = gameManager;
    }

    @GetMapping("/info")
    public ConvoyDetailInfo getConvoyInfo() {
        return new ConvoyDetailInfo(false, gameManager.getConvoy());
    }
}