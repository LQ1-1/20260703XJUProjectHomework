package com.example.ubootgame.dto;

public class UBoatInfo extends ShipInfo {
    private int torpedoCount;
    private String username;

    public UBoatInfo() {}

    public int getTorpedoCount() {
        return torpedoCount;
    }

    public void setTorpedoCount(int torpedoCount) {
        this.torpedoCount = torpedoCount;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }
}