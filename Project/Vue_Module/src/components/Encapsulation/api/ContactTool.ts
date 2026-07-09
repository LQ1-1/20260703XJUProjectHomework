import request from './request'





//潜艇通信（信息通信）发
/*
1.sender: captain name
2.sender UUID

3.receiver: captain name
4.receiver UUID

5.content{A: Convoy Location, B: Convoy Heading Degree, C: Convoy Speed, D: Ship Amount}

6.tf      test flag
*/
export async function sendTelegram(param: any = null){
    return await request.post('/communication/send', param)
}





//潜艇通信（信息通信）收
/*


*/
export async function receiveTelegram(param: any = null){
    return await request.get('/communication/receive', { params: param })
}






//获取目标船队消息
/*
1.
2.Convoy detail information array [Ship A{model UUID, location, heading degree, speed, state}, Ship B{}, Ship C{}, Ship D{}]
3.
4. tf test flag
*/
export async function getConvoyInformation(param: any = null){
    return await request.get('/convoy/info', { params: param })
}





//获取狼群的信息（其他潜艇的信息）
/*
1.
2.Wolf pack detail information array [U-boat A{model UUID, location, heading degree, speed, depth}, U-boat B{}, U-boat C{}, U-boat D{}]
3. tf
*/
export async function getWolfPackInfos(param: any = null){
    return await request.get('/wolfpack/infos', { params: param })
}








//上传本艇信息
/*
1.send UUID
2.U-boat information: model UUID, location, heading degree, speed, depth
3. tf
*/
export async function uploadUBoatInfo(param: any = null){
    return await request.post('/wolfpack/upload', param)
}






//上传击沉记录
/*
1.命中目标uuid
2.captain uuid
*/
export async function uploadSinkRecord(param: any = null){
    return await request.post('/sink-record/upload', param)
}




//获取战绩记录
/*
1.
2.
*/
export async function getSinkRecord(param: any = null){
    return await request.get('/sink-record/records', { params: param })
}
