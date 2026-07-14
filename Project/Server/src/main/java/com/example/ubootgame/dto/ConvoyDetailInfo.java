package com.example.ubootgame.dto;

import java.util.List;

public class ConvoyDetailInfo {
    private boolean tf;
    private List<CargoshipInfo> convoy;

    public ConvoyDetailInfo() {}

    public ConvoyDetailInfo(boolean tf, List<CargoshipInfo> convoy) {
        this.tf = tf;
        this.convoy = convoy;
    }

    public boolean isTf() {
        return tf;
    }

    public void setTf(boolean tf) {
        this.tf = tf;
    }

    public List<CargoshipInfo> getConvoy() {
        return convoy;
    }

    public void setConvoy(List<CargoshipInfo> convoy) {
        this.convoy = convoy;
    }
}