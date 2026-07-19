




export class TorpedoFireControlComputerParameter {

    public AOB: number; //角度°
    public Distance: number;    //游戏单位
    public TargetSpeed: number; //游戏速度单位
    public TorpedorSpeed: number    //游戏速度单位

    constructor(AOB: number, Distance: number, TargetSpeed: number, TorpedorSpeed: number) {
        this.AOB = AOB;
        this.Distance = Distance;
        this.TargetSpeed = TargetSpeed;
        this.TorpedorSpeed = TorpedorSpeed;
    }

    getTime(): number {
        if (
            !Number.isFinite(this.AOB) ||   //isFinite判断是不是有限数字，避免被异常值污染
            !Number.isFinite(this.Distance) ||
            !Number.isFinite(this.TargetSpeed) ||
            !Number.isFinite(this.TorpedorSpeed) ||
            this.Distance <= 0 ||
            this.TargetSpeed < 0 ||
            this.TorpedorSpeed <= 0
        ) {
            return -1
        }

        const AngleOnBoard = (Math.PI * this.AOB) / 180.0

        //cos(C)=(a^2 + b^2 - c^2)/(2ab)
        //c^2 = a^2 + b^2 -2ab cos(C)
        const a = Math.pow(this.TargetSpeed, 2) - Math.pow(this.TorpedorSpeed, 2)
        const b = -2 * this.TargetSpeed * this.Distance * Math.cos(AngleOnBoard)
        const c = Math.pow(this.Distance, 2) 

        if (Math.abs(a) < 0.000001) {   //处理二次方程退化成一次方程的情况
            if (Math.abs(b) < 0.000001) return -1
            const linearTime = -c / b
            return Number.isFinite(linearTime) && linearTime >= 0 ? linearTime : -1
        }

        const discriminant = Math.pow(b, 2) - 4 * a * c     //判别式
        if (discriminant < 0) return -1 //无解

        const sqrtDiscriminant = Math.sqrt(discriminant)
        const time1 = (-b + sqrtDiscriminant) / (2 * a)
        const time2 = (-b - sqrtDiscriminant) / (2 * a)
        const validTimes = [time1, time2]
            .filter((time) => Number.isFinite(time) && time >= 0)
            .sort((left, right) => left - right)

        return validTimes[0] ?? -1
    }

    getTorpedorDistance(): number {
        return this.getTime() * this.TorpedorSpeed;
    }

    getInterceptAngel(): number {
        const TorpedorTime = this.getTime()
        const TorpedorDistance = this.getTorpedorDistance()

        if (
            !Number.isFinite(TorpedorTime) ||
            !Number.isFinite(TorpedorDistance) ||
            TorpedorTime < 0 ||
            TorpedorDistance <= 0 ||
            this.Distance <= 0
        ) {
            return NaN
        }

        //cos(拦截角度)= (鱼雷运动距离^2 + 距离^2 - 目标运动距离^2)/(2 x 鱼雷距离 x 距离)

        const cosInterceptAngel = (
            Math.pow(this.Distance, 2) +
            Math.pow(TorpedorDistance, 2) -
            Math.pow(this.TargetSpeed * TorpedorTime, 2)
        ) / (2 * this.Distance * TorpedorDistance)

        const clampedCos = Math.min(1, Math.max(-1, cosInterceptAngel)) //将cosInterceptAngel确保在-1, 1之间
        const InterceptAngel_radian = Math.acos(clampedCos) //弧度制拦截角度， acos = arccos
        const InterceptAngel_Degree = InterceptAngel_radian * 180 / Math.PI //将弧度制转换成角度制

        return InterceptAngel_Degree
    }

}

export class AOBComputer {
    public targetRealHeading?: number
    public ownShipRealHeading?: number
    public targetRelativeBearingDial?: number

    constructor(targetRealHeading?: number, ownShipRealHeading?: number, targetRelativeBearingDial?: number) {
        this.targetRealHeading = targetRealHeading
        this.ownShipRealHeading = ownShipRealHeading
        this.targetRelativeBearingDial = targetRelativeBearingDial
    }

    getAOB() {
        const tRH = this.targetRealHeading ?? 0
        const oSRH = this.ownShipRealHeading ?? 0
        const tRBD = this.targetRelativeBearingDial ?? 0
        return 180.0 - tRH + oSRH + tRBD
    }
}

export class RangeComputer {
    public MilReading: number;
    public TargetRealHight: number;
    public RangeFactor: number = 139.518

    constructor(MilReading: number, TargetRealHight: number) {
        this.MilReading = MilReading;
        this.TargetRealHight = TargetRealHight;
    }

    getDistance() {
        if (
            !Number.isFinite(this.MilReading) ||
            !Number.isFinite(this.TargetRealHight) ||
            this.MilReading <= 0 ||
            this.TargetRealHight <= 0
        ) {
            return NaN
        }
        return this.RangeFactor * (this.TargetRealHight / this.MilReading)
    }
}

/*
1节=0.5144m/s =1.85184km/h
*/

// let testCase = new TorpedoFireControlComputerParameter(78, 1590, 7, 30);
// console.log(`拦截角度：${testCase.getInterceptAngel()}; 需要时间：${testCase.getTime()}, 鱼雷航行距离：${testCase.getTorpedorDistance()}`)


/*

目标距离的计算方法:
1.通过潜望镜读出目标在潜望镜里的垂直方向的刻度长度
2.测距公式：（真实船高/垂直密位读数）x 测距系数
测距系数=139.518
真实船高=25.803


目标航向的计算方法:
1.测算目标方位（相对艇艏方位）+ 距离 并在地图上标点
2.间隔60～120秒再次测算目标方位（相对艇艏方位） + 距离 并在地图上标点
3.两点连成一条线就可以在地图上测算出目标的航向了




Angel On Board的计算方法: 
AOB = 180 - 目标航向+自身航向+目标方位（相对艇艏方位）

正负表示左右舷的情况
右舷：0～180
左舷：-180到0
带符号AOB =(((360 + 自身航向 + 目标方位（相对艇艏方位） - 目标航向) % 360 + 360) % 360) - 180
潜艇在目标的右舷AOB就是正的
潜艇在目标左舷AOB就是负的


提前量的正负和AOB角有关，
AOB为负说明潜艇在目标左舷，鱼雷航向=目标的绝对方位-提前量
AOB为正说明潜艇在目标的右舷，鱼雷航向=目标绝对方位+提前量


*/





