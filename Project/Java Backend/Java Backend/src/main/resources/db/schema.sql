CREATE DATABASE IF NOT EXISTS uboat_game
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE uboat_game;

CREATE TABLE IF NOT EXISTS commanders (
  kommandant_uuid VARCHAR(64) PRIMARY KEY,
  kommandant_name VARCHAR(100) NOT NULL,
  uboat_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_commanders_uboat_id (uboat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token VARCHAR(128) PRIMARY KEY,
  kommandant_uuid VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  CONSTRAINT fk_auth_tokens_commanders
    FOREIGN KEY (kommandant_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE CASCADE,
  KEY idx_auth_tokens_commander (kommandant_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rooms (
  room_id VARCHAR(64) PRIMARY KEY,
  room_name VARCHAR(100) NULL,
  max_players INT NOT NULL DEFAULT 8,
  created_by_uuid VARCHAR(64) NULL,
  convoy_start_side VARCHAR(8) NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  CONSTRAINT fk_rooms_created_by
    FOREIGN KEY (created_by_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS room_players (
  room_id VARCHAR(64) NOT NULL,
  kommandant_uuid VARCHAR(64) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  last_seen_at TIMESTAMP NULL,
  PRIMARY KEY (room_id, kommandant_uuid),
  CONSTRAINT fk_room_players_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_room_players_commanders
    FOREIGN KEY (kommandant_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE CASCADE,
  KEY idx_room_players_room_active (room_id, left_at),
  KEY idx_room_players_commander_active (kommandant_uuid, left_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS text_messages (
  message_id VARCHAR(64) PRIMARY KEY,
  room_id VARCHAR(64) NOT NULL,
  sender_uuid VARCHAR(64) NOT NULL,
  sender_name VARCHAR(100) NOT NULL,
  receiver_uuids JSON NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_text_messages_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_text_messages_sender
    FOREIGN KEY (sender_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE CASCADE,
  KEY idx_text_messages_room_created (room_id, created_at),
  KEY idx_text_messages_room_id (room_id, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS server_notices (
  notice_id VARCHAR(64) PRIMARY KEY,
  room_id VARCHAR(64) NOT NULL,
  level VARCHAR(16) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_server_notices_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  KEY idx_server_notices_room_created (room_id, created_at),
  KEY idx_server_notices_room_id (room_id, notice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS uboat_states (
  room_id VARCHAR(64) NOT NULL,
  model_id VARCHAR(64) NOT NULL,
  kommandant_uuid VARCHAR(64) NOT NULL,
  kommandant_name VARCHAR(100) NULL,
  uboat_id VARCHAR(64) NULL,
  lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'active',
  hit_by_model_id VARCHAR(64) NULL,
  hit_by_kommandant_uuid VARCHAR(64) NULL,
  hit_at TIMESTAMP(3) NULL,
  sunk_at TIMESTAMP(3) NULL,
  heading_degrees DOUBLE NOT NULL,
  speed_kmh DOUBLE NOT NULL,
  location_x DOUBLE NOT NULL,
  location_z DOUBLE NOT NULL,
  depth_meters DOUBLE NOT NULL,
  navigation_state VARCHAR(64) NULL,
  torpedoes_remaining INT NOT NULL DEFAULT 14,
  last_update_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, model_id),
  CONSTRAINT fk_uboat_states_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_uboat_states_commanders
    FOREIGN KEY (kommandant_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE CASCADE,
  KEY idx_uboat_states_room_commander (room_id, kommandant_uuid),
  KEY idx_uboat_states_lifecycle (room_id, lifecycle_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cargo_ship_states (
  room_id VARCHAR(64) NOT NULL,
  model_id VARCHAR(64) NOT NULL,
  lifecycle_state VARCHAR(16) NOT NULL DEFAULT 'active',
  hit_by_model_id VARCHAR(64) NULL,
  hit_by_kommandant_uuid VARCHAR(64) NULL,
  hit_at TIMESTAMP(3) NULL,
  sunk_at TIMESTAMP(3) NULL,
  heading_degrees DOUBLE NOT NULL,
  speed_knots DOUBLE NOT NULL,
  location_x DOUBLE NOT NULL,
  location_z DOUBLE NOT NULL,
  depth_meters DOUBLE NOT NULL DEFAULT 0,
  tonnage INT NULL,
  last_update_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, model_id),
  CONSTRAINT fk_cargo_ship_states_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  KEY idx_cargo_ship_states_lifecycle (room_id, lifecycle_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS torpedo_states (
  room_id VARCHAR(64) NOT NULL,
  model_id VARCHAR(64) NOT NULL,
  owner_model_id VARCHAR(64) NOT NULL,
  heading_degrees DOUBLE NOT NULL,
  speed_knots DOUBLE NOT NULL,
  location_x DOUBLE NOT NULL,
  location_z DOUBLE NOT NULL,
  depth_meters DOUBLE NOT NULL,
  last_update_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, model_id),
  CONSTRAINT fk_torpedo_states_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  KEY idx_torpedo_states_owner (room_id, owner_model_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS torpedo_launches (
  room_id VARCHAR(64) NOT NULL,
  torpedo_model_id VARCHAR(64) NOT NULL,
  owner_model_id VARCHAR(64) NOT NULL,
  kommandant_uuid VARCHAR(64) NOT NULL,
  launched_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, torpedo_model_id),
  CONSTRAINT fk_torpedo_launches_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_torpedo_launches_commanders
    FOREIGN KEY (kommandant_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE CASCADE,
  KEY idx_torpedo_launches_owner (room_id, owner_model_id),
  KEY idx_torpedo_launches_commander (room_id, kommandant_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hit_reports (
  room_id VARCHAR(64) NOT NULL,
  target_model_id VARCHAR(64) NOT NULL,
  attacker_model_id VARCHAR(64) NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  torpedo_model_id VARCHAR(64) NOT NULL,
  hit_time TIMESTAMP(3) NOT NULL,
  reporter_uuid VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, target_model_id),
  CONSTRAINT fk_hit_reports_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_hit_reports_reporter
    FOREIGN KEY (reporter_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE CASCADE,
  KEY idx_hit_reports_attacker (room_id, attacker_model_id),
  KEY idx_hit_reports_reporter (room_id, reporter_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settlement_records (
  room_id VARCHAR(64) NOT NULL,
  kommandant_uuid VARCHAR(64) NOT NULL,
  cargo_ships_sunk INT NOT NULL DEFAULT 0,
  total_tonnage INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (room_id, kommandant_uuid),
  CONSTRAINT fk_settlement_records_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_settlement_records_commanders
    FOREIGN KEY (kommandant_uuid) REFERENCES commanders (kommandant_uuid)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_results (
  room_id VARCHAR(64) PRIMARY KEY,
  state VARCHAR(16) NOT NULL,
  reason VARCHAR(32) NULL,
  cargo_ships_sunk INT NOT NULL,
  total_cargo_ships INT NOT NULL,
  sunk_ratio DOUBLE NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_game_results_rooms
    FOREIGN KEY (room_id) REFERENCES rooms (room_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
