package com.example.ubootgame.dto;

public class HitRecordTonnage {
    private String senderUUID;
    private int totalTonnages;

    public HitRecordTonnage() {}

    public HitRecordTonnage(String senderUUID, int totalTonnages) {
        this.senderUUID = senderUUID;
        this.totalTonnages = totalTonnages;
    }

    public String getSenderUUID() {
        return senderUUID;
    }

    public void setSenderUUID(String senderUUID) {
        this.senderUUID = senderUUID;
    }

    public int getTotalTonnages() {
        return totalTonnages;
    }

    public void setTotalTonnages(int totalTonnages) {
        this.totalTonnages = totalTonnages;
    }
}