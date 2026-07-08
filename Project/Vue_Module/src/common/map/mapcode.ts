class MapCode{
    public x: number
    public z: number

    public MapSize=12150.0

    public sizeLevel1=4050.0
    public sizeLevel2=1350.0
    public sizeLevel3=450.0

    public gridMapLevel1 = new Map<string, string>()
    public gridMapLevel2 = new Map<string, string>()

    constructor(x: number, z: number){
        this.x=x
        this.z=z

        this.gridMapLevel1.set(this.gridKey(0,0), 'AD')
        this.gridMapLevel1.set(this.gridKey(1,0), 'AE')
        this.gridMapLevel1.set(this.gridKey(2,0), 'AF')

        this.gridMapLevel1.set(this.gridKey(0,1), 'AK')
        this.gridMapLevel1.set(this.gridKey(1,1), 'AL')
        this.gridMapLevel1.set(this.gridKey(2,1), 'AM')
    
        this.gridMapLevel1.set(this.gridKey(0,2), 'BD')
        this.gridMapLevel1.set(this.gridKey(1,2), 'BE')
        this.gridMapLevel1.set(this.gridKey(2,2), 'BF')


        this.gridMapLevel2.set(this.gridKey(0,0), '1')
        this.gridMapLevel2.set(this.gridKey(1,0), '2')
        this.gridMapLevel2.set(this.gridKey(2,0), '3')

        this.gridMapLevel2.set(this.gridKey(0,1), '4')
        this.gridMapLevel2.set(this.gridKey(1,1), '5')
        this.gridMapLevel2.set(this.gridKey(2,1), '6')

        this.gridMapLevel2.set(this.gridKey(0,2), '7')
        this.gridMapLevel2.set(this.gridKey(1,2), '8')
        this.gridMapLevel2.set(this.gridKey(2,2), '9')
    }


    //返回区域代码如AD516这种
    getLocation(){

        if(this.x < 0 || this.x >this.MapSize || this.z<0 || this.z>this.MapSize){
            return '0_Out of Game Area'
        }

        //1.锁定第一层
        let level_1_x=Math.floor(this.x/this.sizeLevel1)
        let level_1_z=Math.floor(this.z/this.sizeLevel1)

        let level1_location=this.gridMapLevel1.get(this.gridKey(level_1_x, level_1_z))

        console.log(`level_1_x: ${level_1_x}; level_1_z: ${level_1_z}; level1_location: ${level1_location}`)

        //2.锁定第二层
        let second_x=this.x%this.sizeLevel1
        let second_z=this.z%this.sizeLevel1

        let level_2_x=Math.floor(second_x/this.sizeLevel2)
        let level_2_z=Math.floor(second_z/this.sizeLevel2)

        let level2_location=this.gridMapLevel2.get(this.gridKey(level_2_x, level_2_z))

        console.log(`level_2_x: ${level_2_x}; level_2_z: ${level_2_z}; level2_location: ${level2_location}`)

        //3.锁定第三层
        let third_x=this.x%this.sizeLevel2
        let third_z=this.z%this.sizeLevel2

        let level_3_x=Math.floor(third_x/this.sizeLevel3)
        let level_3_z=Math.floor(third_z/this.sizeLevel3)

        let level3_location=this.gridMapLevel2.get(this.gridKey(level_3_x, level_3_z))

        console.log(`level_3_x: ${level_3_x}; level_3_z: ${level_3_z}; level3_location: ${level3_location}`)

        //返回最终位置代码
        return `${level1_location}${level2_location}${level3_location}`
    }


    gridKey(row: number, col: number){
        return `${row}:${col}`
    }

}