import request from './request'

//---- DTO ----//
export class ShipInfo {
    public headingDegrees: number
    public speed: number
    public location: { x: number, z: number }
    public depth: number

    constructor(newHeadingDegrees: number, newSpeed: number, newLocation: { x: number, z: number }, newDepth: number) {
        this.headingDegrees = newHeadingDegrees
        this.speed = newSpeed
        this.location = newLocation
        this.depth = newDepth
    }
}

//单条商船信息/ 船队信息总体的信息
export class CargoshipInfo extends ShipInfo {
    constructor(newHeadingDegrees: number, newSpeed: number, newLocation: { x: number, z: number }, newDepth: number = 0) {
        super(newHeadingDegrees, newSpeed, newLocation, 0)  //商船默认潜深为0
    }
}

//潜艇信息
export class UBoatInfo extends ShipInfo {
    constructor(newHeadingDegrees: number, newSpeed: number, newLocation: { x: number, z: number }, newDepth: number) {
        super(newHeadingDegrees, newSpeed, newLocation, newDepth)
    }
}

//上传命中记录
export class HitRecordShip {
    public senderUUID: string
    public targetUUID: string
    public time: Date   //击沉时间

    constructor(nSenderUUID: string, nTargetUUID: string, nTime: Date) {
        this.senderUUID = nSenderUUID
        this.targetUUID = nTargetUUID
        this.time = nTime
    }
}

//击沉吨位数
export class HitRecordTonnage {
    public senderUUID: string
    public totalTonnages: number

    constructor(nSenderUUID: string, nTotalTonnages: number) {
        this.senderUUID = nSenderUUID
        this.totalTonnages = nTotalTonnages
    }
}

//击沉船只数
export class HitRecordsShips {
    public tf: boolean
    public records: HitRecordShip[]

    constructor(nTf: boolean, nRecords: HitRecordShip[]) {
        this.tf = nTf
        this.records = nRecords
    }
}

//吨位数总榜
export class HitRecordsTonnages {
    public tf: boolean
    public records: HitRecordTonnage[]
    constructor(nTf: boolean, nRecords: HitRecordTonnage[]) {
        this.tf = nTf
        this.records = nRecords
    }
}

//通讯信息
export class Communication {
    public sender: string
    public senderUUID: string   //KommandantID

    public receiver: string
    public receiverUUID: string

    public content: CargoshipInfo

    constructor(nSender: string, nSenderUUID: string, nReceiver: string, nReceiverUUID: string, nContent: CargoshipInfo) {
        this.sender = nSender
        this.senderUUID = nSenderUUID
        this.receiver = nReceiver
        this.receiverUUID = nReceiverUUID
        this.content = nContent
    }
}

//商船总体信息
export class ConvoyDetailInfo {
    public tf: boolean      //tf为一就表示是测试数据
    public convoy: CargoshipInfo[]

    constructor(nTf: boolean, nConvoy: CargoshipInfo[]) {
        this.tf = nTf
        this.convoy = nConvoy
    }
}

//狼群总体信息
export class wolfpackDetailInfo {
    public tf: boolean
    public wolfpack: UBoatInfo[]

    constructor(nTf: boolean, nWolfpack: UBoatInfo[]) {
        this.tf = nTf
        this.wolfpack = nWolfpack
    }

}


export class UBoatKommandant{
    public KommandantName?: string   //指挥官姓名（用户输入）
    public KommandantUUID?: string   //指挥官ID      
    public UBoatID?: string  //潜艇编号（用户输入）

    constructor(KommandantName?: string, KommandantUUID?: string, UBoatID?: string){
        this.KommandantName=KommandantName
        this.KommandantUUID=KommandantUUID
        this.UBoatID=UBoatID
    }
}

export class LoginDTO{
    public KommandantUUID?: string
    constructor(KommandantUUID?: string){
        this.KommandantUUID=KommandantUUID
    }
}

export class RoomDTO{
    public RoomID?: string
    public PlayerAmount?: number
    public maxPlayers?: number
    public status?: 'joinable' | 'full'
    constructor(RoomID?: string, PlayerAmount?: number, maxPlayers?: number, status?: 'joinable' | 'full'){
        this.RoomID=RoomID
        this.PlayerAmount=PlayerAmount
        this.maxPlayers=maxPlayers
        this.status=status
    }
}

export interface RoomCreateDTO {
    maxPlayers?: number
    roomName?: string
}

export interface RoomJoinDTO {
    RoomID: string
}

export interface RoomLeaveDTO {
    RoomID: string
}

export interface RoomPlayerDTO {
    KommandantUUID: string
    KommandantName: string
    UBoatID: string
    online: boolean
}

export interface TextMessageDTO {
    RoomID: string
    receiverUUIDs: string[]
    content: string
}

export interface ModelLifecycleDTO {
    modelID: string
    lifecycleState: 'active' | 'sinking' | 'sunk'
    hitByModelID?: string
    hitByKommandantUUID?: string
    hitAt?: string
    sunkAt?: string
}

export interface OnlineUBoatStateDTO extends ModelLifecycleDTO {
    KommandantUUID: string
    KommandantName?: string
    UBoatID?: string
    headingDegrees: number
    speedKmh: number
    location: { x: number, z: number }
    depthMeters: number
    torpedoesRemaining?: number
    navigationState?: string
    lastUpdateAt?: string
}

export interface OnlineCargoShipStateDTO extends ModelLifecycleDTO {
    headingDegrees: number
    speedKnots: number
    location: { x: number, z: number }
    depthMeters: number
    tonnage?: number
    lastUpdateAt?: string
}

export interface OnlineTorpedoStateDTO {
    modelID: string
    ownerModelID: string
    headingDegrees: number
    speedKnots: number
    location: { x: number, z: number }
    depthMeters: number
    lastUpdateAt?: string
}

export interface OnlineTorpedoSyncDTO {
    RoomID: string
    torpedo: OnlineTorpedoStateDTO
}

export interface HitReportDTO {
    RoomID: string
    attackerModelID: string
    targetModelID: string
    targetType: 'cargoShip' | 'uBoat'
    torpedoModelID: string
    hitTime: string
}

export interface SunkConfirmDTO {
    RoomID: string
    modelID: string
    modelType: 'cargoShip' | 'uBoat'
    sunkAt: string
}

export interface WorldSyncDTO {
    RoomID: string
    selfUBoat?: OnlineUBoatStateDTO
}

export interface SettlementDTO {
    RoomID: string
    KommandantUUID: string
    cargoShipsSunk: number
    totalTonnage: number
}

export interface GameResultDTO {
    RoomID: string
    state: 'playing' | 'victory' | 'defeat'
    reason?: 'cargo_sunk_threshold' | 'cargo_arrived' | 'torpedoes_depleted' | 'all_uboats_sunk'
    cargoShipsSunk: number
    totalCargoShips: number
    sunkRatio: number
}



//---------------- 出口函数 --------------------//
/*

调用方式:
let result = await login(loginParam)

console.log(result)
console.log(result.code)
console.log(result.message)
console.log(result.data)
console.log(result.data.KommandantName)

*/


//登录接口
export async function login(param: LoginDTO){
    return await request.post('/login', param)
}

//注册接口
export async function registration(param: UBoatKommandant){
    return await request.post('/registration', param)
}



//潜艇通信（信息通信）发
/*
1.sender: captain name
2.sender UUID

3.receiver: captain name
4.receiver UUID

5.content{A: Convoy Location, B: Convoy Heading Degree, C: Convoy Speed, D: Ship Amount}

6.tf      test flag
*/
/** @deprecated 后端第一版只支持 TextMessageDTO，请使用 sendTextMessage。 */
export async function sendTelegram(param: Communication) {
    return await request.post('/communication/send', param)
}

export async function sendTextMessage(param: TextMessageDTO) {
    return await request.post('/communication/send', param)
}





//潜艇通信（信息通信）收
/*


*/
export async function receiveTelegram(RoomID?: string, after?: string) {
    return await request.get('/communication/receive', { params: { RoomID, after } })
}

export async function receiveServerNotice(RoomID?: string, after?: string) {
    return await request.get('/server/notice', { params: { RoomID, after } })
}






//获取目标船队消息
/*
1.
2.Convoy detail information array [Ship A{model UUID, location, heading degree, speed, state}, Ship B{}, Ship C{}, Ship D{}]
3.
4. tf test flag
*/
/** @deprecated 后端第一版不实现 /convoy/info，请使用 getWorldSync(RoomID) 中的 cargoShips。 */
export async function getConvoyInformation() {
    return await request.get('/convoy/info')
}





//获取狼群的信息（其他潜艇的信息）
/*
1.
2.Wolf pack detail information array [U-boat A{model UUID, location, heading degree, speed, depth}, U-boat B{}, U-boat C{}, U-boat D{}]
3. tf
*/
/** @deprecated 后端第一版不实现 /wolfpack/infos，请使用 getWorldSync(RoomID) 中的 uBoats。 */
export async function getWolfPackInfos() {
    return await request.get('/wolfpack/infos')
}








//上传本艇信息
/*
1.send UUID
2.U-boat information: model UUID, location, heading degree, speed, depth
3. tf
*/
/** @deprecated 后端第一版不实现 /wolfpack/upload，请使用 uploadOnlineUBoatState。 */
export async function uploadUBoatInfo(param: UBoatInfo) {
    return await request.post('/wolfpack/upload', param)
}






//上传击沉记录
/*
1.命中目标uuid
2.captain uuid
*/
/** @deprecated 后端第一版不实现 /sink-record/upload，请使用 reportModelHit 和 confirmModelSunk。 */
export async function uploadSinkRecord(param: HitRecordShip) {
    return await request.post('/sink-record/upload', param)
}




//获取战绩记录(击沉船只信息)
/*
1.
2.
*/
/** @deprecated 后端第一版不实现该接口，请使用 getWorldSync(RoomID) 中的 settlement/gameResult。 */
export async function getSinkRecordsShips() {
    return await request.get('/sink-record/records/ships')
}



//获取战绩记录(击沉总吨位信息)
/*
1.
2.
*/
/** @deprecated 后端第一版不实现该接口，请使用 getWorldSync(RoomID) 中的 settlement/gameResult。 */
export async function getSinkRecordsTonnages() {
    return await request.get('/sink-record/records/tonnages')
}



//获取房间信息
export async function getRoomInfos(){
    return await request.get('/room/info')
}

//进入房间
export async function enterRoom(param: RoomJoinDTO){
    return await request.post('/room/enter', param)
}

//创建房间
export async function createRoom(param: RoomCreateDTO){
    return await request.post('/room/create', param)
}

export async function getRoomDetail(RoomID: string){
    return await request.get('/room/detail', { params: { RoomID } })
}

export async function leaveRoom(param: RoomLeaveDTO){
    return await request.post('/room/leave', param)
}

export async function uploadOnlineUBoatState(param: WorldSyncDTO){
    return await request.post('/sync/uboat', param)
}

export async function uploadOnlineTorpedoState(param: OnlineTorpedoSyncDTO){
    return await request.post('/sync/torpedo', param)
}

export async function getWorldSync(RoomID: string){
    return await request.get('/sync/world', { params: { RoomID } })
}

export async function reportModelHit(param: HitReportDTO){
    return await request.post('/model/hit', param)
}

export async function confirmModelSunk(param: SunkConfirmDTO){
    return await request.post('/model/sunk-confirm', param)
}
