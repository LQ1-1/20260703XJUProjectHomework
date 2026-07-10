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

export class HitRecordTonnage {
    public senderUUID: string
    public totalTonnages: number

    constructor(nSenderUUID: string, nTotalTonnages: number) {
        this.senderUUID = nSenderUUID
        this.totalTonnages = nTotalTonnages
    }
}

export class HitRecordsShips {
    public tf: boolean
    public records: HitRecordShip[]

    constructor(nTf: boolean, nRecords: HitRecordShip[]) {
        this.tf = nTf
        this.records = nRecords
    }
}

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
    public senderUUID: string

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

export class ConvoyDetailInfo {
    public tf: boolean      //tf为一就表示是测试数据
    public convoy: CargoshipInfo[]

    constructor(nTf: boolean, nConvoy: CargoshipInfo[]) {
        this.tf = nTf
        this.convoy = nConvoy
    }
}

export class wolfpackDetailInfo {
    public tf: boolean
    public wolfpack: UBoatInfo[]

    constructor(nTf: boolean, nWolfpack: UBoatInfo[]) {
        this.tf = nTf
        this.wolfpack = nWolfpack
    }

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
export async function sendTelegram(param: Communication) {
    return await request.post('/communication/send', param)
}





//潜艇通信（信息通信）收
/*


*/
export async function receiveTelegram(param: Communication) {
    return await request.get('/communication/receive', { params: param })
}






//获取目标船队消息
/*
1.
2.Convoy detail information array [Ship A{model UUID, location, heading degree, speed, state}, Ship B{}, Ship C{}, Ship D{}]
3.
4. tf test flag
*/
export async function getConvoyInformation(param: ConvoyDetailInfo) {
    return await request.get('/convoy/info', { params: param })
}





//获取狼群的信息（其他潜艇的信息）
/*
1.
2.Wolf pack detail information array [U-boat A{model UUID, location, heading degree, speed, depth}, U-boat B{}, U-boat C{}, U-boat D{}]
3. tf
*/
export async function getWolfPackInfos(param: wolfpackDetailInfo) {
    return await request.get('/wolfpack/infos', { params: param })
}








//上传本艇信息
/*
1.send UUID
2.U-boat information: model UUID, location, heading degree, speed, depth
3. tf
*/
export async function uploadUBoatInfo(param: UBoatInfo) {
    return await request.post('/wolfpack/upload', param)
}






//上传击沉记录
/*
1.命中目标uuid
2.captain uuid
*/
export async function uploadSinkRecord(param: HitRecordShip) {
    return await request.post('/sink-record/upload', param)
}




//获取战绩记录(击沉船只信息)
/*
1.
2.
*/
export async function getSinkRecordsShips(param: HitRecordsShips) {
    return await request.get('/sink-record/records/ships', { params: param })
}



//获取战绩记录(击沉总吨位信息)
/*
1.
2.
*/
export async function getSinkRecordsTonnages(param: HitRecordsTonnages) {
    return await request.get('/sink-record/records/ships', { params: param })
}