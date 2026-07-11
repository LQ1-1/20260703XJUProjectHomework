
export const OFFSETSENSITIVITY = 200    //偏移灵敏度，鼠标移动1个像素，相对于在地图上移动200个单位的长度

export class myPair<T, U> {
    constructor(public first: T, public second: U) { }
    //first=X; second=Z
}

//本游戏地图的工具类
export class MapCode {
    //游戏区域是X:0到12150， Z:0到12150
    //超出区域视为脱离游戏区域


    public x: number
    public z: number

    public MapSize: number = 12150.0

    public sizeLevel1: number = 4050.0
    public sizeLevel2: number = 1350.0
    public sizeLevel3: number = 450.0

    public gridMapLevel1 = new Map<string, string>()
    public gridMapLevel2 = new Map<string, string>()

    public gridMapLevel1_nummap = new Map<string, myPair<number, number>>()
    public gridMapLevel2_nummap = new Map<string, myPair<number, number>>()


    constructor(x: number=0, z: number=0) {
        this.x = x
        this.z = z

        this.initMaps()
    }

    initMaps() {
        //初始化number->code的map
        this.gridMapLevel1.set(this.gridKey(0, 0), 'AD')
        this.gridMapLevel1.set(this.gridKey(1, 0), 'AE')
        this.gridMapLevel1.set(this.gridKey(2, 0), 'AF')

        this.gridMapLevel1.set(this.gridKey(0, 1), 'AK')
        this.gridMapLevel1.set(this.gridKey(1, 1), 'AL')
        this.gridMapLevel1.set(this.gridKey(2, 1), 'AM')

        this.gridMapLevel1.set(this.gridKey(0, 2), 'BD')
        this.gridMapLevel1.set(this.gridKey(1, 2), 'BE')
        this.gridMapLevel1.set(this.gridKey(2, 2), 'BF')


        this.gridMapLevel2.set(this.gridKey(0, 0), '1')
        this.gridMapLevel2.set(this.gridKey(1, 0), '2')
        this.gridMapLevel2.set(this.gridKey(2, 0), '3')

        this.gridMapLevel2.set(this.gridKey(0, 1), '4')
        this.gridMapLevel2.set(this.gridKey(1, 1), '5')
        this.gridMapLevel2.set(this.gridKey(2, 1), '6')

        this.gridMapLevel2.set(this.gridKey(0, 2), '7')
        this.gridMapLevel2.set(this.gridKey(1, 2), '8')
        this.gridMapLevel2.set(this.gridKey(2, 2), '9')

        //初始化code->number
        this.gridMapLevel1_nummap.set('AD', new myPair<number,number>(0,0))
        this.gridMapLevel1_nummap.set('AE', new myPair<number,number>(1, 0))
        this.gridMapLevel1_nummap.set('AF', new myPair<number,number>(2, 0))

        this.gridMapLevel1_nummap.set('AK', new myPair<number,number>(0, 1))
        this.gridMapLevel1_nummap.set('AL', new myPair<number,number>(1, 1))
        this.gridMapLevel1_nummap.set('AM', new myPair<number,number>(2, 1))

        this.gridMapLevel1_nummap.set('BD', new myPair<number,number>(0, 2))
        this.gridMapLevel1_nummap.set('BE', new myPair<number,number>(1, 2))
        this.gridMapLevel1_nummap.set('BF', new myPair<number,number>(2, 2))


        this.gridMapLevel2_nummap.set('1', new myPair<number,number>(0, 0))
        this.gridMapLevel2_nummap.set('2', new myPair<number,number>(1, 0))
        this.gridMapLevel2_nummap.set('3', new myPair<number,number>(2, 0))

        this.gridMapLevel2_nummap.set('4', new myPair<number,number>(0, 1))
        this.gridMapLevel2_nummap.set('5', new myPair<number,number>(1, 1))
        this.gridMapLevel2_nummap.set('6', new myPair<number,number>(2, 1))

        this.gridMapLevel2_nummap.set('7', new myPair<number,number>(0, 2))
        this.gridMapLevel2_nummap.set('8', new myPair<number,number>(1, 2))
        this.gridMapLevel2_nummap.set('9', new myPair<number,number>(2, 2))

    }


    //返回区域代码如AD516这种
    getLocationCode() {

        if (this.x < 0 || this.x > this.MapSize || this.z < 0 || this.z > this.MapSize) {
            return '0_Out of Game Area'
        }

        //1.锁定第一层
        let level_1_x = Math.floor(this.x / this.sizeLevel1)
        let level_1_z = Math.floor(this.z / this.sizeLevel1)

        let level1_location = this.gridMapLevel1.get(this.gridKey(level_1_x, level_1_z))

        console.log(`level_1_x: ${level_1_x}; level_1_z: ${level_1_z}; level1_location: ${level1_location}`)

        //2.锁定第二层
        let second_x = this.x % this.sizeLevel1
        let second_z = this.z % this.sizeLevel1

        let level_2_x = Math.floor(second_x / this.sizeLevel2)
        let level_2_z = Math.floor(second_z / this.sizeLevel2)

        let level2_location = this.gridMapLevel2.get(this.gridKey(level_2_x, level_2_z))

        console.log(`level_2_x: ${level_2_x}; level_2_z: ${level_2_z}; level2_location: ${level2_location}`)

        //3.锁定第三层
        let third_x = this.x % this.sizeLevel2
        let third_z = this.z % this.sizeLevel2

        let level_3_x = Math.floor(third_x / this.sizeLevel3)
        let level_3_z = Math.floor(third_z / this.sizeLevel3)

        let level3_location = this.gridMapLevel2.get(this.gridKey(level_3_x, level_3_z))

        console.log(`level_3_x: ${level_3_x}; level_3_z: ${level_3_z}; level3_location: ${level3_location}`)

        //返回最终位置代码
        return `${level1_location}${level2_location}${level3_location}`
    }

    getWorldLocation(locationCode: string) {
        //AD16
        //0123
        let level1_location_code = locationCode.substring(0, 2)    //截取0，1两个字符
        let level2_location_code = locationCode.substring(2, 3)
        let level3_location_code = locationCode.substring(3, 4)

        console.log(`${level1_location_code}, ${level2_location_code}, ${level3_location_code}`)

        let location1=this.gridMapLevel1_nummap.get(level1_location_code)
        let location2=this.gridMapLevel2_nummap.get(level2_location_code)
        let location3=this.gridMapLevel2_nummap.get(level3_location_code)

        console.log(`计算中： location1:${location1?.first}, ${location1?.second};
            location2:${location2?.first}, ${location2?.second},
            location3:${location3?.first}, ${location3?.second}
            `)


        let locationX=0
        let locationZ=0

        locationX+=(location1?.first ?? 0)*this.sizeLevel1
        locationZ+=(location1?.second ?? 0)*this.sizeLevel1

        locationX+=(location2?.first ?? 0)*this.sizeLevel2
        locationZ+=(location2?.second ?? 0)*this.sizeLevel2

        locationX+=(location3?.first ?? 0)*this.sizeLevel3
        locationZ+=(location3?.second ?? 0)*this.sizeLevel3

        let res=new myPair<number, number>(locationX, locationZ);
        return res;
    }


    gridKey(row: number, col: number) {
        return `${row}:${col}`
    }

    //根据layer返回一个瓦片图对应的地图的边的长度（游戏地图单位）
    private getTileLayerSize(layer: number) {
        if (layer === 0) {
            return this.sizeLevel1
        }

        if (layer === 1) {
            return this.sizeLevel2
        }

        return this.sizeLevel3
    }

    //获取layer对应的瓦片的行数（列数）
    private getTileLayerCount(layer: number) {
        if (layer === 0) {
            return 3
        }

        if (layer === 1) {
            return 9
        }

        return 27
    }

    //封装图片读取路径
    private getTileMapPath(layer: number, column: number, row: number) {
        return new URL(
            `../../assets/Tile Maps/tiles/${layer}/tile_${column}_${row}.png`,
            import.meta.url,
        ).href
    }

    private getTileMapsByCenter(centerX: number, centerZ: number, layer: number) {
        const tileSize = this.getTileLayerSize(layer)   //对应的层级的瓦片地图对应的的地图长度不同
        const tileCount = this.getTileLayerCount(layer)
        const maxTileIndex = tileCount - 1  //瓦片地图的行号，列号边界

        const column = Math.floor(centerX / tileSize)   //地图坐标转换成列
        const row = Math.floor(centerZ / tileSize)      //地图坐标转换成行

        const offsets: number[] = [-1, 0, 1]
        const pathResults: string[] = []

        for (let dz of offsets) {
            for (let dx of offsets) {
                const newRow = row + dz
                const newColumn = column + dx

                if (
                    newRow >= 0 &&
                    newRow <= maxTileIndex &&
                    newColumn >= 0 &&
                    newColumn <= maxTileIndex
                ) {
                    pathResults.push(this.getTileMapPath(layer, newColumn, newRow))
                }
            }
        }

        return pathResults
    }

    //随着玩家控制的潜艇移动而动态加载瓦片地图的函数
    getTileMapsPlayerCenter(Zoom: number){
        let scrollZoom = this.getTileMapLayer(Zoom)

        return this.getTileMapsByCenter(this.x, this.z, scrollZoom)
    }
    /*
    调用方式
    let mapCode =new MapCode(playerX, playerZ)
    let mapPaths: string[] = mapCode.getTileMapsPlayerCenter(playerZoom)
    */


    //----------------处理滚动缩放的瓦片地图加载地图-------------------//
    //改变大小
    private zoom: number=1  //放大倍率

    //改变位置
    //相当于一个二维向量
    //相对原始位置进行偏移
    private offsetX: number=0   //X轴偏移量
    private offsetZ: number=0   //Z轴偏移量

    public mapSize: number=1350.0

    updateScrollZoomParas(newZoom: number, newOffsetX: number, newOffsetZ:number){
        this.zoom=newZoom
        this.offsetX=newOffsetX
        this.offsetZ=newOffsetZ
    }

    getTileMapLayer(Zoom: number): number {
        if(Zoom<1){
            return 0
        }else if(Zoom<2){
            return 1
        }else{
            return 2
        }
    }

    getTileMapsMouseDrag(){
        let layer=this.getTileMapLayer(this.zoom)
        let newCenterX = this.x - this.offsetX * OFFSETSENSITIVITY
        let newCenterZ = this.z - this.offsetZ * OFFSETSENSITIVITY

        return this.getTileMapsByCenter(newCenterX, newCenterZ, layer)
    
    }
    /*
    调用方式
    let mapCode = new MapCode()
    mapCode.updateScrollZoomParas(鼠标缩放倍率, 鼠标移动x像素(横向), 鼠标移动z像素(纵向))
    let mapPaths: string[]= mapCode.getTileMapsMouseDrag()
    */


    //------------------------------------------------------------------//

}


// let test2=new MapCode(0,0);
// console.log(`1000, 550对应的Code是AD16,经过转换: ${test2.getWorldLocation('AD16').first}, ${test2.getWorldLocation('AD16').second}`);

