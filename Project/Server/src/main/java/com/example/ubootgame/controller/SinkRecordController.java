package com.example.ubootgame.controller;

import com.example.ubootgame.dto.HitRecordShip;
import com.example.ubootgame.dto.HitRecordsShips;
import com.example.ubootgame.dto.HitRecordsTonnages;
import com.example.ubootgame.game.GameManager;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/sink-record")
public class SinkRecordController {

    private final GameManager gameManager;

    public SinkRecordController(GameManager gameManager) {
        this.gameManager = gameManager;
    }

    @PostMapping("/upload")
    public Map<String, Boolean> uploadHitRecord(@RequestBody HitRecordShip record) {
        if (record.getSenderUUID() == null || record.getSenderUUID().isEmpty()) {
            throw new IllegalArgumentException("Sender UUID is required");
        }
        if (record.getTargetUUID() == null || record.getTargetUUID().isEmpty()) {
            throw new IllegalArgumentException("Target UUID is required");
        }
        gameManager.addHitRecord(record.getSenderUUID(), record.getTargetUUID());
        return Map.of("success", true);
    }

    @GetMapping("/records/ships")
    public HitRecordsShips getHitRecordsShips() {
        return new HitRecordsShips(false, gameManager.getHitRecordsShips());
    }

    @GetMapping("/records/tonnages")
    public HitRecordsTonnages getHitRecordsTonnages() {
        return new HitRecordsTonnages(false, gameManager.getHitRecordsTonnages());
    }
}