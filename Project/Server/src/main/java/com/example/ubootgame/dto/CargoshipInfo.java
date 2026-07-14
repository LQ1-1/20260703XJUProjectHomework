package com.example.ubootgame.dto;

public class CargoshipInfo extends ShipInfo {
    private boolean destroyed;

    public CargoshipInfo() {}

    public boolean isDestroyed() {
        return destroyed;
    }

    public void setDestroyed(boolean destroyed) {
        this.destroyed = destroyed;
    }
}