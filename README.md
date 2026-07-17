# U-Boat Game

[中文](README.zh-CN.md)

A full-stack U-boat combat simulation project built with Vue 3, Three.js, TypeScript, Spring Boot, MyBatis, and MySQL. The project contains a browser-based 3D submarine game, offline and online play modes, room management, real-time world synchronization, chat/communication features, and backend persistence for commanders, rooms, ship states, torpedoes, hit reports, settlement records, and game results.

## Features

- 3D submarine gameplay with Three.js-based ocean, camera, input, submarine, torpedo, and cargo ship controllers.
- Offline mode for local gameplay and online mode for room-based multiplayer sessions.
- Commander registration and login with token-based authentication.
- Room creation, joining, leaving, player list updates, and room detail queries.
- WebSocket room channel for real-time gameplay events, including U-boat input, torpedo fire events, model hit reports, sunk confirmations, chat messages, world snapshots, and game results.
- MySQL-backed data model for commanders, auth tokens, rooms, players, messages, notices, U-boat states, cargo ship states, torpedo states, hit records, settlement records, and final game results.
- Frontend HUD and tools, including bearing compass, range computer, AOB computer, torpedo data computer, underwater status panel, voyage map, and communication panel.

## Repository Structure

```text
.
├── LICENSE
├── README.md
├── README.zh-CN.md
└── Project
    ├── Java Backend
    │   ├── pom.xml
    │   └── src
    │       ├── main/java/com/uboatgame_backend
    │       └── main/resources
    └── Vue_Module
        ├── package.json
        ├── vite.config.ts
        └── src
```

## Tech Stack

Frontend:

- Vue 3
- Vite
- TypeScript
- Three.js
- Axios

Backend:

- Java 21
- Spring Boot
- Spring Web MVC
- Spring WebSocket
- MyBatis
- MySQL

## Prerequisites

- Node.js `^22.18.0` or `>=24.12.0`
- npm
- JDK 21
- Maven
- MySQL 8.x or compatible

## Database Setup

Create the database schema before starting the backend:

```sh
mysql -u root -p < "Project/Java Backend/src/main/resources/db/schema.sql"
```

The backend uses `Project/Java Backend/src/main/resources/application.properties` by default. Update the local MySQL username, password, host, port, and database name as needed:

```properties
spring.datasource.url=jdbc:mysql://localhost:3306/uboot_game?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
spring.datasource.username=your_mysql_user
spring.datasource.password=your_mysql_password
server.port=30302
```

## Running the Backend

```sh
cd "Project/Java Backend"
mvn spring-boot:run
```

The backend starts on:

```text
http://localhost:30302
```

Health check:

```text
GET http://localhost:30302/api/health
```

## Running the Frontend

```sh
cd Project/Vue_Module
npm install
npm run dev
```

By default, Vite prints the local frontend URL in the terminal.

If the frontend and backend are served from different origins during development, create a local `.env` file under `Project/Vue_Module`:

```env
VITE_API_BASE=http://localhost:30302/api
VITE_WS_BASE=ws://localhost:30302
```

## Frontend Routes

- `/mode` - mode selection
- `/login` - commander login/registration
- `/room` - online room list and room flow
- `/UboatGame_Offline` - offline gameplay
- `/UboatGame_Online` - online gameplay
- `/UboatGame_Online_Demo` - online demo gameplay

## Useful Backend Endpoints

Authentication and health:

- `GET /api/health`
- `POST /api/registration`
- `POST /api/login`

Room APIs:

- `GET /api/room/info`
- `POST /api/room/create`
- `POST /api/room/enter`
- `GET /api/room/detail?RoomID=...`
- `POST /api/room/leave`
- `POST /api/room/ws-ticket`

Synchronization and gameplay APIs:

- `POST /api/sync/uboat`
- `POST /api/sync/torpedo`
- `GET /api/sync/world?RoomID=...`
- `POST /api/model/hit`
- `POST /api/model/sunk-confirm`

Communication APIs:

- `POST /api/communication/send`
- `GET /api/communication/receive?RoomID=...`
- `GET /api/server/notice?RoomID=...`

WebSocket:

- `ws://localhost:30302/ws/room?ticket=...`

## Build

Frontend production build:

```sh
cd Project/Vue_Module
npm run build
```

Backend package:

```sh
cd "Project/Java Backend"
mvn package
```

## Notes

- The frontend API client reads `VITE_API_BASE`; if it is not set, it falls back to `/api`.
- The frontend WebSocket client reads `VITE_WS_BASE`; if it is not set, it uses the current browser host.
- Online mode requires the backend and MySQL database to be running.
- Offline mode can be used without the multiplayer room backend.

## License

See [LICENSE](LICENSE).
