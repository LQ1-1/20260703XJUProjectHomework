package com.example.ubootgame.dto;

public class HitRecordShip {
    private String senderUUID;
    private String targetUUID;
    private String time;

    public HitRecordShip() {}

    public HitRecordShip(String senderUUID, String targetUUID, String time) {
        this.senderUUID = senderUUID;
        this.targetUUID = targetUUID;
        this.time = time;
    }

    public String getSenderUUID() {
        return senderUUID;
    }

    public void setSenderUUID(String senderUUID) {
        this.senderUUID = senderUUID;
    }

    public String getTargetUUID() {
        return targetUUID;
    }

    public void setTargetUUID(String targetUUID) {
        this.targetUUID = targetUUID;
    }

    public String getTime() {
        return time;
    }

    public void setTime(String time) {
        this.time = time;
    }
}