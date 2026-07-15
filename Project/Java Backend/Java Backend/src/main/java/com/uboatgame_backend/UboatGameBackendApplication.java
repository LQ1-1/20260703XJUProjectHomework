package com.uboatgame_backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class UboatGameBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(UboatGameBackendApplication.class, args);
    }

}
