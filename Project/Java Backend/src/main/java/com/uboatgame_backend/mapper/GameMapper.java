package com.uboatgame_backend.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;

@Mapper
public interface GameMapper {
    @Select("SELECT acquire_room_write_lock(#{roomId}, #{timeoutSeconds})")
    Integer acquireRoomWriteLock(@Param("roomId") String roomId, @Param("timeoutSeconds") int timeoutSeconds);

    @Select("SELECT release_room_write_lock(#{roomId})")
    Integer releaseRoomWriteLock(@Param("roomId") String roomId);

    @Select("""
            SELECT c.kommandant_uuid, c.kommandant_name, c.uboat_id
            FROM auth_tokens t
            JOIN commanders c ON c.kommandant_uuid = t.kommandant_uuid
            WHERE t.token = #{token}
              AND t.revoked_at IS NULL
              AND (t.expires_at IS NULL OR t.expires_at > CURRENT_TIMESTAMP)
            """)
    List<Map<String, Object>> findAuthUserByToken(@Param("token") String token);

    @Insert("""
            INSERT INTO commanders (kommandant_uuid, kommandant_name, uboat_id)
            VALUES (#{uuid}, #{name}, #{uBoatId})
            """)
    int insertCommander(@Param("uuid") String uuid, @Param("name") String name, @Param("uBoatId") String uBoatId);

    @Select("""
            SELECT kommandant_uuid, kommandant_name, uboat_id
            FROM commanders
            WHERE kommandant_uuid = #{uuid}
            """)
    List<Map<String, Object>> findCommanderByUuid(@Param("uuid") String uuid);

    @Insert("""
            INSERT INTO auth_tokens (token, kommandant_uuid, expires_at)
            VALUES (#{token}, #{uuid}, #{expiresAt})
            """)
    int insertAuthToken(@Param("token") String token, @Param("uuid") String uuid, @Param("expiresAt") Timestamp expiresAt);

    @Select("""
            SELECT r.room_id, r.max_players,
                   COUNT(rp.kommandant_uuid) AS player_amount
            FROM rooms r
            LEFT JOIN room_players rp ON rp.room_id = r.room_id AND rp.left_at IS NULL
            WHERE r.closed_at IS NULL
            GROUP BY r.room_id, r.max_players, r.created_at
            ORDER BY r.created_at DESC
            """)
    List<Map<String, Object>> selectOpenRoomInfos();

    @Insert("""
            INSERT INTO rooms (room_id, room_name, max_players, created_by_uuid, convoy_start_side)
            VALUES (#{roomId}, #{roomName}, #{maxPlayers}, #{createdByUuid}, #{convoyStartSide})
            """)
    int insertRoom(@Param("roomId") String roomId, @Param("roomName") String roomName,
                   @Param("maxPlayers") int maxPlayers, @Param("createdByUuid") String createdByUuid,
                   @Param("convoyStartSide") String convoyStartSide);

    @Select("SELECT COUNT(*) FROM rooms WHERE room_id = #{roomId} AND closed_at IS NULL")
    int countOpenRoom(@Param("roomId") String roomId);

    @Select("SELECT max_players FROM rooms WHERE room_id = #{roomId}")
    Integer selectRoomMaxPlayers(@Param("roomId") String roomId);

    @Select("SELECT room_id, max_players FROM rooms WHERE room_id = #{roomId}")
    Map<String, Object> selectRoom(@Param("roomId") String roomId);

    @Insert("""
            INSERT INTO room_players (room_id, kommandant_uuid, last_seen_at)
            VALUES (#{roomId}, #{uuid}, CURRENT_TIMESTAMP)
            ON DUPLICATE KEY UPDATE left_at = NULL, joined_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
            """)
    int upsertRoomPlayer(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Select("""
            SELECT COUNT(*) FROM room_players
            WHERE room_id = #{roomId} AND kommandant_uuid = #{uuid} AND left_at IS NULL
            """)
    int countActiveRoomPlayer(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Select("SELECT COUNT(*) FROM room_players WHERE room_id = #{roomId} AND left_at IS NULL")
    int countActivePlayers(@Param("roomId") String roomId);

    @Select("""
            SELECT room_id FROM room_players
            WHERE kommandant_uuid = #{uuid} AND left_at IS NULL
            """)
    List<String> selectActiveRoomIdsByCommander(@Param("uuid") String uuid);

    @Update("""
            UPDATE room_players
            SET left_at = CURRENT_TIMESTAMP
            WHERE room_id = #{roomId} AND kommandant_uuid = #{uuid} AND left_at IS NULL
            """)
    int markRoomPlayerLeft(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Update("UPDATE rooms SET closed_at = CURRENT_TIMESTAMP WHERE room_id = #{roomId} AND closed_at IS NULL")
    int closeRoom(@Param("roomId") String roomId);

    @Select("""
            SELECT c.kommandant_uuid, c.kommandant_name, c.uboat_id, rp.last_seen_at
            FROM room_players rp
            JOIN commanders c ON c.kommandant_uuid = rp.kommandant_uuid
            WHERE rp.room_id = #{roomId} AND rp.left_at IS NULL
            ORDER BY rp.joined_at ASC
            """)
    List<Map<String, Object>> selectRoomPlayers(@Param("roomId") String roomId);

    @Update("UPDATE rooms SET revision = revision + 1 WHERE room_id = #{roomId}")
    int touchRoom(@Param("roomId") String roomId);

    @Select("SELECT revision FROM rooms WHERE room_id = #{roomId}")
    Long selectRoomRevision(@Param("roomId") String roomId);

    @Insert("""
            INSERT INTO cargo_ship_states
                (room_id, model_id, heading_degrees, speed_knots, location_x, location_z, depth_meters, tonnage)
            VALUES (#{roomId}, #{modelId}, #{headingDegrees}, #{speedKnots}, #{locationX}, #{locationZ}, 0, #{tonnage})
            """)
    int insertCargoShip(@Param("roomId") String roomId, @Param("modelId") String modelId,
                        @Param("headingDegrees") double headingDegrees, @Param("speedKnots") double speedKnots,
                        @Param("locationX") double locationX, @Param("locationZ") double locationZ,
                        @Param("tonnage") int tonnage);

    @Insert("""
            INSERT INTO uboat_states
                (room_id, model_id, kommandant_uuid, kommandant_name, uboat_id,
                 heading_degrees, speed_kmh, location_x, location_z, depth_meters, torpedoes_remaining)
            VALUES (#{roomId}, #{modelId}, #{uuid}, #{name}, #{uBoatId}, #{heading}, 0, #{x}, #{z}, 0, #{torpedoes})
            ON DUPLICATE KEY UPDATE
                kommandant_name = VALUES(kommandant_name),
                uboat_id = VALUES(uboat_id),
                last_update_at = CURRENT_TIMESTAMP(3)
            """)
    int insertUBoatState(@Param("roomId") String roomId, @Param("modelId") String modelId,
                         @Param("uuid") String uuid, @Param("name") String name,
                         @Param("uBoatId") String uBoatId, @Param("heading") double heading,
                         @Param("x") double x, @Param("z") double z, @Param("torpedoes") int torpedoes);

    @Select("""
            SELECT location_x, location_z
            FROM uboat_states us
            JOIN room_players rp ON rp.room_id = us.room_id AND rp.kommandant_uuid = us.kommandant_uuid
            WHERE us.room_id = #{roomId} AND rp.left_at IS NULL
            """)
    List<Map<String, Object>> selectActiveUBoatLocations(@Param("roomId") String roomId);

    @Select("SELECT model_id FROM uboat_states WHERE room_id = #{roomId} AND kommandant_uuid = #{uuid}")
    List<String> selectUBoatModelIdsByCommander(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Delete("DELETE FROM torpedo_states WHERE room_id = #{roomId} AND owner_model_id = #{ownerModelId}")
    int deleteTorpedoesByOwner(@Param("roomId") String roomId, @Param("ownerModelId") String ownerModelId);

    @Delete("DELETE FROM uboat_states WHERE room_id = #{roomId} AND kommandant_uuid = #{uuid}")
    int deleteUBoatStatesByCommander(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Insert("""
            INSERT INTO text_messages (message_id, room_id, sender_uuid, sender_name, receiver_uuids, content)
            VALUES (#{messageId}, #{roomId}, #{senderUuid}, #{senderName}, #{receiverUuids}, #{content})
            """)
    int insertTextMessage(@Param("messageId") String messageId, @Param("roomId") String roomId,
                          @Param("senderUuid") String senderUuid, @Param("senderName") String senderName,
                          @Param("receiverUuids") String receiverUuids, @Param("content") String content);

    @Select("""
            SELECT message_id, room_id, sender_uuid, sender_name, receiver_uuids, content, created_at
            FROM text_messages WHERE message_id = #{messageId}
            """)
    Map<String, Object> selectTextMessage(@Param("messageId") String messageId);

    @Select("""
            SELECT message_id, room_id, sender_uuid, sender_name, receiver_uuids, content, created_at
            FROM text_messages
            WHERE room_id = #{roomId}
              AND (JSON_CONTAINS(receiver_uuids, JSON_QUOTE(#{uuid})) OR sender_uuid = #{uuid})
            ORDER BY created_at ASC
            """)
    List<Map<String, Object>> selectVisibleMessages(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Select("""
            SELECT message_id, room_id, sender_uuid, sender_name, receiver_uuids, content, created_at
            FROM text_messages
            WHERE room_id = #{roomId}
              AND (JSON_CONTAINS(receiver_uuids, JSON_QUOTE(#{uuid})) OR sender_uuid = #{uuid})
              AND created_at > COALESCE((SELECT created_at FROM text_messages WHERE message_id = #{after}), TIMESTAMP('1970-01-01'))
            ORDER BY created_at ASC
            """)
    List<Map<String, Object>> selectVisibleMessagesAfter(@Param("roomId") String roomId, @Param("uuid") String uuid,
                                                         @Param("after") String after);

    @Select("""
            SELECT notice_id, room_id, level, content, created_at
            FROM server_notices
            WHERE room_id = #{roomId}
            ORDER BY created_at ASC
            """)
    List<Map<String, Object>> selectServerNotices(@Param("roomId") String roomId);

    @Select("""
            SELECT notice_id, room_id, level, content, created_at
            FROM server_notices
            WHERE room_id = #{roomId}
              AND created_at > COALESCE((SELECT created_at FROM server_notices WHERE notice_id = #{after}), TIMESTAMP('1970-01-01'))
            ORDER BY created_at ASC
            """)
    List<Map<String, Object>> selectServerNoticesAfter(@Param("roomId") String roomId, @Param("after") String after);

    @Update("""
            UPDATE uboat_states
            SET heading_degrees = #{headingDegrees}, speed_kmh = #{speedKmh}, location_x = #{locationX}, location_z = #{locationZ},
                depth_meters = #{depthMeters}, navigation_state = #{navigationState}, last_update_at = CURRENT_TIMESTAMP(3)
            WHERE room_id = #{roomId} AND model_id = #{modelId} AND kommandant_uuid = #{uuid}
            """)
    int updateUBoatState(@Param("roomId") String roomId, @Param("modelId") String modelId, @Param("uuid") String uuid,
                         @Param("headingDegrees") double headingDegrees, @Param("speedKmh") double speedKmh,
                         @Param("locationX") double locationX, @Param("locationZ") double locationZ,
                         @Param("depthMeters") double depthMeters, @Param("navigationState") String navigationState);

    @Update("""
            UPDATE room_players
            SET last_seen_at = CURRENT_TIMESTAMP
            WHERE room_id = #{roomId} AND kommandant_uuid = #{uuid} AND left_at IS NULL
            """)
    int touchRoomPlayer(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Select("SELECT COUNT(*) FROM uboat_states WHERE room_id = #{roomId} AND model_id = #{modelId} AND kommandant_uuid = #{uuid}")
    int countOwnedUBoat(@Param("roomId") String roomId, @Param("modelId") String modelId, @Param("uuid") String uuid);

    @Select("SELECT COUNT(*) FROM torpedo_launches WHERE room_id = #{roomId} AND torpedo_model_id = #{torpedoModelId}")
    int countTorpedoLaunch(@Param("roomId") String roomId, @Param("torpedoModelId") String torpedoModelId);

    @Select("""
            SELECT torpedoes_remaining FROM uboat_states
            WHERE room_id = #{roomId} AND model_id = #{modelId} AND kommandant_uuid = #{uuid}
            """)
    Integer selectTorpedoesRemaining(@Param("roomId") String roomId, @Param("modelId") String modelId, @Param("uuid") String uuid);

    @Insert("""
            INSERT IGNORE INTO torpedo_launches (room_id, torpedo_model_id, owner_model_id, kommandant_uuid)
            VALUES (#{roomId}, #{torpedoModelId}, #{ownerModelId}, #{uuid})
            """)
    int insertTorpedoLaunch(@Param("roomId") String roomId, @Param("torpedoModelId") String torpedoModelId,
                            @Param("ownerModelId") String ownerModelId, @Param("uuid") String uuid);

    @Update("""
            UPDATE uboat_states SET torpedoes_remaining = torpedoes_remaining - 1
            WHERE room_id = #{roomId} AND model_id = #{modelId} AND kommandant_uuid = #{uuid}
            """)
    int decrementTorpedoes(@Param("roomId") String roomId, @Param("modelId") String modelId, @Param("uuid") String uuid);

    @Insert("""
            INSERT INTO torpedo_states
                (room_id, model_id, owner_model_id, heading_degrees, speed_knots, location_x, location_z, depth_meters)
            VALUES (#{roomId}, #{modelId}, #{ownerModelId}, #{headingDegrees}, #{speedKnots}, #{locationX}, #{locationZ}, #{depthMeters})
            ON DUPLICATE KEY UPDATE
                owner_model_id = VALUES(owner_model_id),
                heading_degrees = VALUES(heading_degrees),
                speed_knots = VALUES(speed_knots),
                location_x = VALUES(location_x),
                location_z = VALUES(location_z),
                depth_meters = VALUES(depth_meters),
                last_update_at = CURRENT_TIMESTAMP(3)
            """)
    int upsertTorpedoState(@Param("roomId") String roomId, @Param("modelId") String modelId,
                           @Param("ownerModelId") String ownerModelId, @Param("headingDegrees") double headingDegrees,
                           @Param("speedKnots") double speedKnots, @Param("locationX") double locationX,
                           @Param("locationZ") double locationZ, @Param("depthMeters") double depthMeters);

    @Select("""
            SELECT us.*
            FROM uboat_states us
            JOIN room_players rp ON rp.room_id = us.room_id AND rp.kommandant_uuid = us.kommandant_uuid
            WHERE us.room_id = #{roomId} AND rp.left_at IS NULL
            """)
    List<Map<String, Object>> selectWorldUBoats(@Param("roomId") String roomId);

    @Select("""
            SELECT * FROM cargo_ship_states
            WHERE room_id = #{roomId} AND lifecycle_state <> 'sunk'
            """)
    List<Map<String, Object>> selectWorldCargoShips(@Param("roomId") String roomId);

    @Select("""
            SELECT ts.*
            FROM torpedo_states ts
            JOIN uboat_states us ON us.room_id = ts.room_id AND us.model_id = ts.owner_model_id
            JOIN room_players rp ON rp.room_id = us.room_id AND rp.kommandant_uuid = us.kommandant_uuid
            WHERE ts.room_id = #{roomId} AND rp.left_at IS NULL
            """)
    List<Map<String, Object>> selectWorldTorpedoes(@Param("roomId") String roomId);

    @Select("SELECT * FROM settlement_records WHERE room_id = #{roomId} AND kommandant_uuid = #{uuid}")
    List<Map<String, Object>> selectSettlement(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Select("""
            SELECT
                COALESCE(SUM(cargo_ships_sunk), 0) AS cargo_ships_sunk,
                COALESCE(SUM(u_boats_sunk), 0) AS u_boats_sunk,
                COALESCE(SUM(total_tonnage), 0) AS total_tonnage,
                COUNT(*) AS games_played
            FROM settlement_records
            WHERE kommandant_uuid = #{uuid}
            """)
    Map<String, Object> selectPlayerRecordSummary(@Param("uuid") String uuid);

    @Select("""
            SELECT
                sr.room_id,
                gr.state,
                gr.reason,
                sr.cargo_ships_sunk,
                sr.u_boats_sunk,
                sr.total_tonnage,
                COALESCE(gr.cargo_ships_sunk, 0) AS room_cargo_ships_sunk,
                COALESCE(gr.total_cargo_ships, 0) AS total_cargo_ships,
                GREATEST(sr.updated_at, COALESCE(gr.created_at, sr.updated_at)) AS updated_at
            FROM settlement_records sr
            LEFT JOIN game_results gr ON gr.room_id = sr.room_id
            WHERE sr.kommandant_uuid = #{uuid}
            ORDER BY updated_at DESC, sr.room_id DESC
            """)
    List<Map<String, Object>> selectPlayerGameRecords(@Param("uuid") String uuid);

    @Select("SELECT * FROM game_results WHERE room_id = #{roomId}")
    List<Map<String, Object>> selectGameResult(@Param("roomId") String roomId);

    @Select("SELECT COUNT(*) FROM hit_reports WHERE room_id = #{roomId} AND target_model_id = #{targetModelId}")
    int countHitReport(@Param("roomId") String roomId, @Param("targetModelId") String targetModelId);

    @Select("""
            SELECT COUNT(*) FROM torpedo_launches
            WHERE room_id = #{roomId} AND torpedo_model_id = #{torpedoModelId} AND owner_model_id = #{ownerModelId}
            """)
    int countTorpedoLaunchOwnedBy(@Param("roomId") String roomId, @Param("torpedoModelId") String torpedoModelId,
                                  @Param("ownerModelId") String ownerModelId);

    @Select("""
            SELECT model_id, lifecycle_state, hit_by_model_id, hit_by_kommandant_uuid, hit_at, sunk_at
            FROM cargo_ship_states
            WHERE room_id = #{roomId} AND model_id = #{modelId}
            """)
    List<Map<String, Object>> selectCargoTarget(@Param("roomId") String roomId, @Param("modelId") String modelId);

    @Select("""
            SELECT model_id, lifecycle_state, hit_by_model_id, hit_by_kommandant_uuid, hit_at, sunk_at
            FROM uboat_states
            WHERE room_id = #{roomId} AND model_id = #{modelId}
            """)
    List<Map<String, Object>> selectUBoatTarget(@Param("roomId") String roomId, @Param("modelId") String modelId);

    @Insert("""
            INSERT INTO hit_reports
                (room_id, target_model_id, attacker_model_id, target_type, torpedo_model_id, hit_time, reporter_uuid)
            VALUES (#{roomId}, #{targetModelId}, #{attackerModelId}, #{targetType}, #{torpedoModelId}, #{hitTime}, #{reporterUuid})
            """)
    int insertHitReport(@Param("roomId") String roomId, @Param("targetModelId") String targetModelId,
                        @Param("attackerModelId") String attackerModelId, @Param("targetType") String targetType,
                        @Param("torpedoModelId") String torpedoModelId, @Param("hitTime") Timestamp hitTime,
                        @Param("reporterUuid") String reporterUuid);

    @Update("""
            UPDATE cargo_ship_states
            SET lifecycle_state = 'sinking', hit_by_model_id = #{attackerModelId}, hit_by_kommandant_uuid = #{uuid}, hit_at = #{hitTime}
            WHERE room_id = #{roomId} AND model_id = #{modelId} AND lifecycle_state <> 'sunk'
            """)
    int markCargoHit(@Param("roomId") String roomId, @Param("modelId") String modelId,
                     @Param("attackerModelId") String attackerModelId, @Param("uuid") String uuid,
                     @Param("hitTime") Timestamp hitTime);

    @Update("""
            UPDATE uboat_states
            SET lifecycle_state = 'sinking', hit_by_model_id = #{attackerModelId}, hit_by_kommandant_uuid = #{uuid}, hit_at = #{hitTime}
            WHERE room_id = #{roomId} AND model_id = #{modelId} AND lifecycle_state <> 'sunk'
            """)
    int markUBoatHit(@Param("roomId") String roomId, @Param("modelId") String modelId,
                     @Param("attackerModelId") String attackerModelId, @Param("uuid") String uuid,
                     @Param("hitTime") Timestamp hitTime);

    @Delete("DELETE FROM torpedo_states WHERE room_id = #{roomId} AND model_id = #{modelId}")
    int deleteTorpedoState(@Param("roomId") String roomId, @Param("modelId") String modelId);

    @Update("UPDATE cargo_ship_states SET lifecycle_state = 'sunk', sunk_at = #{sunkAt} WHERE room_id = #{roomId} AND model_id = #{modelId}")
    int markCargoSunk(@Param("roomId") String roomId, @Param("modelId") String modelId, @Param("sunkAt") Timestamp sunkAt);

    @Update("UPDATE uboat_states SET lifecycle_state = 'sunk', sunk_at = #{sunkAt} WHERE room_id = #{roomId} AND model_id = #{modelId}")
    int markUBoatSunk(@Param("roomId") String roomId, @Param("modelId") String modelId, @Param("sunkAt") Timestamp sunkAt);

    @Select("""
            SELECT reporter_uuid, target_type
            FROM hit_reports
            WHERE room_id = #{roomId} AND target_model_id = #{targetModelId}
            """)
    List<Map<String, Object>> selectHitSettlementSource(@Param("roomId") String roomId, @Param("targetModelId") String targetModelId);

    @Insert("""
            INSERT INTO settlement_records (room_id, kommandant_uuid, cargo_ships_sunk, u_boats_sunk, total_tonnage)
            VALUES (#{roomId}, #{uuid}, #{cargoShipsSunk}, #{uBoatsSunk}, #{tonnage})
            ON DUPLICATE KEY UPDATE
                cargo_ships_sunk = cargo_ships_sunk + VALUES(cargo_ships_sunk),
                u_boats_sunk = u_boats_sunk + VALUES(u_boats_sunk),
                total_tonnage = total_tonnage + VALUES(total_tonnage)
            """)
    int incrementSettlement(@Param("roomId") String roomId, @Param("uuid") String uuid,
                            @Param("cargoShipsSunk") int cargoShipsSunk,
                            @Param("uBoatsSunk") int uBoatsSunk,
                            @Param("tonnage") int tonnage);

    @Select("SELECT kommandant_uuid FROM uboat_states WHERE room_id = #{roomId} AND model_id = #{modelId}")
    List<String> selectUBoatCommanderByModel(@Param("roomId") String roomId, @Param("modelId") String modelId);

    @Insert("""
            INSERT INTO settlement_records (room_id, kommandant_uuid, cargo_ships_sunk, u_boats_sunk, total_tonnage)
            VALUES (#{roomId}, #{uuid}, 0, 0, 0)
            ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)
            """)
    int ensureSettlement(@Param("roomId") String roomId, @Param("uuid") String uuid);

    @Select("SELECT room_id, convoy_start_side FROM rooms WHERE closed_at IS NULL")
    List<Map<String, Object>> selectOpenRoomsForTick();

    @Update("""
            UPDATE cargo_ship_states
            SET location_x = #{locationX}, location_z = #{locationZ}, last_update_at = CURRENT_TIMESTAMP(3)
            WHERE room_id = #{roomId} AND model_id = #{modelId} AND lifecycle_state = 'active'
            """)
    int updateCargoShipPosition(@Param("roomId") String roomId, @Param("modelId") String modelId,
                                @Param("locationX") double locationX, @Param("locationZ") double locationZ);

    @Delete("""
            DELETE FROM torpedo_states
            WHERE room_id = #{roomId}
              AND (
                last_update_at < (CURRENT_TIMESTAMP(3) - INTERVAL 60 SECOND)
                OR model_id IN (
                  SELECT torpedo_model_id
                  FROM torpedo_launches
                  WHERE room_id = #{roomId}
                    AND launched_at < (CURRENT_TIMESTAMP(3) - INTERVAL 324 SECOND)
                )
              )
            """)
    int cleanupOldTorpedoes(@Param("roomId") String roomId);

    @Select("SELECT COUNT(*) FROM torpedo_states WHERE room_id = #{roomId}")
    int countActiveTorpedoes(@Param("roomId") String roomId);

    @Select("SELECT convoy_start_side FROM rooms WHERE room_id = #{roomId}")
    String selectConvoyStartSide(@Param("roomId") String roomId);

    @Select("SELECT COUNT(*) FROM cargo_ship_states WHERE room_id = #{roomId} AND lifecycle_state = 'active' AND location_x >= #{mapSize}")
    int countArrivedFromLeft(@Param("roomId") String roomId, @Param("mapSize") double mapSize);

    @Select("SELECT COUNT(*) FROM cargo_ship_states WHERE room_id = #{roomId} AND lifecycle_state = 'active' AND location_x <= 0")
    int countArrivedFromRight(@Param("roomId") String roomId);

    @Select("""
            SELECT COUNT(*)
            FROM uboat_states us
            JOIN room_players rp ON rp.room_id = us.room_id AND rp.kommandant_uuid = us.kommandant_uuid
            WHERE us.room_id = #{roomId} AND rp.left_at IS NULL AND us.lifecycle_state <> 'sunk' AND us.torpedoes_remaining > 0
            """)
    int countActivePlayersWithTorpedoes(@Param("roomId") String roomId);

    @Select("""
            SELECT COUNT(*)
            FROM uboat_states us
            JOIN room_players rp ON rp.room_id = us.room_id AND rp.kommandant_uuid = us.kommandant_uuid
            WHERE us.room_id = #{roomId} AND rp.left_at IS NULL AND us.lifecycle_state <> 'sunk'
            """)
    int countActiveUnsunkUBoats(@Param("roomId") String roomId);

    @Select("SELECT COUNT(*) FROM cargo_ship_states WHERE room_id = #{roomId} AND lifecycle_state = 'sunk'")
    int countSunkCargo(@Param("roomId") String roomId);

    @Insert("""
            INSERT INTO game_results (room_id, state, reason, cargo_ships_sunk, total_cargo_ships, sunk_ratio)
            VALUES (#{roomId}, #{state}, #{reason}, #{sunk}, #{total}, #{ratio})
            """)
    int insertGameResult(@Param("roomId") String roomId, @Param("state") String state,
                         @Param("reason") String reason, @Param("sunk") int sunk,
                         @Param("total") int total, @Param("ratio") double ratio);

    @Insert("""
            INSERT INTO server_notices (notice_id, room_id, level, content)
            VALUES (#{noticeId}, #{roomId}, #{level}, #{content})
            """)
    int insertServerNotice(@Param("noticeId") String noticeId, @Param("roomId") String roomId,
                           @Param("level") String level, @Param("content") String content);
}
