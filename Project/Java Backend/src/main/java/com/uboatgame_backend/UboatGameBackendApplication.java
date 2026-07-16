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
import java.sql.ResultSet;
import java.sql.Statement;

@SpringBootApplication
@EnableScheduling
public class UboatGameBackendApplication {
    private static final Logger log = LoggerFactory.getLogger(UboatGameBackendApplication.class);

    public static void main(String[] args) {
        SpringApplication.run(UboatGameBackendApplication.class, args);
    }

    @Bean
    public ApplicationRunner databaseSchemaGuard(DataSource dataSource) {
        return args -> {
            try (Connection connection = dataSource.getConnection()) {
                DatabaseMetaData metaData = connection.getMetaData();
                log.info("Database connection test succeeded: url={}, database={} {}, driver={} {}",
                        metaData.getURL(),
                        metaData.getDatabaseProductName(),
                        metaData.getDatabaseProductVersion(),
                        metaData.getDriverName(),
                        metaData.getDriverVersion());

                try (ResultSet columns = metaData.getColumns(connection.getCatalog(), null, "settlement_records", "u_boats_sunk")) {
                    if (columns.next()) {
                        log.info("Database schema guard: settlement_records.u_boats_sunk already exists");
                        return;
                    }
                }

                log.warn("Database schema guard: settlement_records.u_boats_sunk is missing, adding column now");
                try (Statement statement = connection.createStatement()) {
                    statement.executeUpdate("""
                            ALTER TABLE settlement_records
                            ADD COLUMN u_boats_sunk INT NOT NULL DEFAULT 0 AFTER cargo_ships_sunk
                            """);
                }
                log.info("Database schema guard: settlement_records.u_boats_sunk added successfully");
            } catch (Exception ex) {
                log.error("Database schema guard failed with detailed exception", ex);
            }
        };
    }
}
