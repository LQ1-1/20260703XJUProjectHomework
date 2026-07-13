package com.example.ubootgame.dto;

import java.util.List;

public class HitRecordsTonnages {
    private boolean tf;
    private List<HitRecordTonnage> records;

    public HitRecordsTonnages() {}

    public HitRecordsTonnages(boolean tf, List<HitRecordTonnage> records) {
        this.tf = tf;
        this.records = records;
    }

    public boolean isTf() {
        return tf;
    }

    public void setTf(boolean tf) {
        this.tf = tf;
    }

    public List<HitRecordTonnage> getRecords() {
        return records;
    }

    public void setRecords(List<HitRecordTonnage> records) {
        this.records = records;
    }
}