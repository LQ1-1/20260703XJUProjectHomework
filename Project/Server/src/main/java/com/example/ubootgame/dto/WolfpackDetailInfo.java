package com.example.ubootgame.dto;

import java.util.List;

public class WolfpackDetailInfo {
    private boolean tf;
    private List<UBoatInfo> wolfpack;

    public WolfpackDetailInfo() {}

    public WolfpackDetailInfo(boolean tf, List<UBoatInfo> wolfpack) {
        this.tf = tf;
        this.wolfpack = wolfpack;
    }

    public boolean isTf() {
        return tf;
    }

    public void setTf(boolean tf) {
        this.tf = tf;
    }

    public List<UBoatInfo> getWolfpack() {
        return wolfpack;
    }

    public void setWolfpack(List<UBoatInfo> wolfpack) {
        this.wolfpack = wolfpack;
    }
}