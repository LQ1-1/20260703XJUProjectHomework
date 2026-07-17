# U-Boat Game 中文说明

[English](README.md)

这是一个基于 Vue 3、Three.js、TypeScript、Spring Boot、MyBatis 和 MySQL 的全栈潜艇作战模拟项目。项目包含浏览器端 3D 潜艇游戏、离线模式、在线房间模式、实时世界同步、通信聊天，以及用于指挥官、房间、舰船状态、鱼雷、命中记录、结算记录和游戏结果的后端持久化能力。

## 功能特性

- 基于 Three.js 的 3D 潜艇玩法，包含海面、摄像机、输入、潜艇、鱼雷和商船控制逻辑。
- 支持离线本地玩法和在线多人房间玩法。
- 支持指挥官注册、登录和 Token 鉴权。
- 支持房间创建、加入、离开、玩家列表更新和房间详情查询。
- 通过 WebSocket 房间通道同步实时游戏事件，包括潜艇输入、鱼雷发射、模型命中、沉没确认、聊天消息、世界快照和游戏结果。
- 使用 MySQL 保存指挥官、认证 Token、房间、玩家、消息、服务器通知、潜艇状态、商船状态、鱼雷状态、命中记录、结算记录和最终游戏结果。
- 前端包含 HUD 和辅助工具，例如方位罗盘、距离计算器、AOB 计算器、鱼雷数据计算器、水下状态面板、航海地图和通信面板。

## 项目结构

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

## 技术栈

前端：

- Vue 3
- Vite
- TypeScript
- Three.js
- Axios

后端：

- Java 21
- Spring Boot
- Spring Web MVC
- Spring WebSocket
- MyBatis
- MySQL

## 环境要求

- Node.js `^22.18.0` 或 `>=24.12.0`
- npm
- JDK 21
- Maven
- MySQL 8.x 或兼容版本

## 数据库初始化

启动后端前先创建数据库和表：

```sh
mysql -u root -p < "Project/Java Backend/src/main/resources/db/schema.sql"
```

后端默认读取 `Project/Java Backend/src/main/resources/application.properties`。请根据本机环境修改 MySQL 用户名、密码、地址、端口和数据库名：

```properties
spring.datasource.url=jdbc:mysql://localhost:3306/uboot_game?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
spring.datasource.username=your_mysql_user
spring.datasource.password=your_mysql_password
server.port=30302
```

## 启动后端

```sh
cd "Project/Java Backend"
mvn spring-boot:run
```

后端默认地址：

```text
http://localhost:30302
```

健康检查：

```text
GET http://localhost:30302/api/health
```

## 启动前端

```sh
cd Project/Vue_Module
npm install
npm run dev
```

Vite 会在终端输出本地前端访问地址。

如果开发时前后端不在同一个源下，可以在 `Project/Vue_Module` 下创建本地 `.env` 文件：

```env
VITE_API_BASE=http://localhost:30302/api
VITE_WS_BASE=ws://localhost:30302
```

## 前端路由

- `/mode` - 模式选择
- `/login` - 指挥官登录/注册
- `/room` - 在线房间列表和房间流程
- `/UboatGame_Offline` - 离线游戏
- `/UboatGame_Online` - 在线游戏
- `/UboatGame_Online_Demo` - 在线演示游戏

## 常用后端接口

认证和健康检查：

- `GET /api/health`
- `POST /api/registration`
- `POST /api/login`

房间接口：

- `GET /api/room/info`
- `POST /api/room/create`
- `POST /api/room/enter`
- `GET /api/room/detail?RoomID=...`
- `POST /api/room/leave`
- `POST /api/room/ws-ticket`

同步和游戏接口：

- `POST /api/sync/uboat`
- `POST /api/sync/torpedo`
- `GET /api/sync/world?RoomID=...`
- `POST /api/model/hit`
- `POST /api/model/sunk-confirm`

通信接口：

- `POST /api/communication/send`
- `GET /api/communication/receive?RoomID=...`
- `GET /api/server/notice?RoomID=...`

WebSocket：

- `ws://localhost:30302/ws/room?ticket=...`

## 构建

前端生产构建：

```sh
cd Project/Vue_Module
npm run build
```

后端打包：

```sh
cd "Project/Java Backend"
mvn package
```

## 注意事项

- 前端 API 客户端会读取 `VITE_API_BASE`；如果未设置，则默认使用 `/api`。
- 前端 WebSocket 客户端会读取 `VITE_WS_BASE`；如果未设置，则默认使用当前浏览器访问的主机。
- 在线模式需要后端服务和 MySQL 数据库正常运行。
- 离线模式可以在不启动多人房间后端的情况下使用。

## 许可证

见 [LICENSE](LICENSE)。
