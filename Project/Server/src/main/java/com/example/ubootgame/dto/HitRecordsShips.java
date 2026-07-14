package com.example.ubootgame.dto;

import java.util.List;

public class HitRecordsShips {
    private boolean tf;
    private List<HitRecordShip> records;

    public HitRecordsShips() {}

    public HitRecordsShips(boolean tf, List<HitRecordShip> records) {
        this.tf = tf;
        this.records = records;
    }

    public boolean isTf() {
        return tf;
    }

    public void setTf(boolean tf) {
        this.tf = tf;
    }

    public List<HitRecordShip> getRecords() {
        return records;
    }

    public void setRecords(List<HitRecordShip> records) {
        this.records = records;
    }
}