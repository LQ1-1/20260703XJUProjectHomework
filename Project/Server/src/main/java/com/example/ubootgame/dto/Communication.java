package com.example.ubootgame.dto;

public class Communication {
    private String sender;
    private String senderUUID;
    private String receiver;
    private String receiverUUID;
    private CargoshipInfo content;
    private boolean tf;

    public Communication() {}

    public String getSender() {
        return sender;
    }

    public void setSender(String sender) {
        this.sender = sender;
    }

    public String getSenderUUID() {
        return senderUUID;
    }

    public void setSenderUUID(String senderUUID) {
        this.senderUUID = senderUUID;
    }

    public String getReceiver() {
        return receiver;
    }

    public void setReceiver(String receiver) {
        this.receiver = receiver;
    }

    public String getReceiverUUID() {
        return receiverUUID;
    }

    public void setReceiverUUID(String receiverUUID) {
        this.receiverUUID = receiverUUID;
    }

    public CargoshipInfo getContent() {
        return content;
    }

    public void setContent(CargoshipInfo content) {
        this.content = content;
    }

    public boolean isTf() {
        return tf;
    }

    public void setTf(boolean tf) {
        this.tf = tf;
    }
}