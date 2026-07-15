package com.uboatgame_backend;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;

@SpringBootApplication
@EnableScheduling
public class UboatGameBackendApplication {
    private static final Logger log = LoggerFactory.getLogger(UboatGameBackendApplication.class);

    public static void main(String[] args) {
        SpringApplication.run(UboatGameBackendApplication.class, args);
    }

    // @Bean
    // public ApplicationRunner databaseConnectionLogger(DataSource dataSource) {
    //     return args -> {
    //         try (Connection connection = dataSource.getConnection()) {
    //             DatabaseMetaData metaData = connection.getMetaData();
    //             log.info("Database connection test succeeded: url={}, database={} {}, driver={} {}",
    //                     metaData.getURL(),
    //                     metaData.getDatabaseProductName(),
    //                     metaData.getDatabaseProductVersion(),
    //                     metaData.getDriverName(),
    //                     metaData.getDriverVersion());
    //         } catch (Exception ex) {
    //             log.error("Database connection test failed", ex);
    //         }
    //     };
    // }
}
