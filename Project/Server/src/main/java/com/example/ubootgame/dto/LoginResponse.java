package com.example.ubootgame.dto;

import java.util.List;

public class LoginResponse {
    private String uuid;
    private String username;
    private Position initialPosition;
    private double initialHeadingDegrees;
    private List<CargoshipInfo> convoy;

    public LoginResponse() {}

    public LoginResponse(String uuid, String username, Position initialPosition, 
                        double initialHeadingDegrees, List<CargoshipInfo> convoy) {
        this.uuid = uuid;
        this.username = username;
        this.initialPosition = initialPosition;
        this.initialHeadingDegrees = initialHeadingDegrees;
        this.convoy = convoy;
    }

    public String getUuid() {
        return uuid;
    }

    public void setUuid(String uuid) {
        this.uuid = uuid;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public Position getInitialPosition() {
        return initialPosition;
    }

    public void setInitialPosition(Position initialPosition) {
        this.initialPosition = initialPosition;
    }

    public double getInitialHeadingDegrees() {
        return initialHeadingDegrees;
    }

    public void setInitialHeadingDegrees(double initialHeadingDegrees) {
        this.initialHeadingDegrees = initialHeadingDegrees;
    }

    public List<CargoshipInfo> getConvoy() {
        return convoy;
    }

    public void setConvoy(List<CargoshipInfo> convoy) {
        this.convoy = convoy;
    }
}