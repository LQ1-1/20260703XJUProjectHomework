




export class TorpedoFireControlComputerParameter {

    public AOB: number;
    public Distance: number;
    public TargetSpeed: number;
    public TorpedorSpeed: number

    constructor(AOB: number, Distance: number, TargetSpeed: number, TorpedorSpeed: number) {
        this.AOB = AOB;
        this.Distance = Distance;
        this.TargetSpeed = TargetSpeed;
        this.TorpedorSpeed = TorpedorSpeed;
    }

    getTime(): number {
        if (
            !Number.isFinite(this.AOB) ||
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

        const a = Math.pow(this.TargetSpeed, 2) - Math.pow(this.TorpedorSpeed, 2)
        const b = -2 * this.TargetSpeed * this.Distance * Math.cos(AngleOnBoard)
        const c = Math.pow(this.Distance, 2)

        if (Math.abs(a) < 0.000001) {
            if (Math.abs(b) < 0.000001) return -1
            const linearTime = -c / b
            return Number.isFinite(linearTime) && linearTime >= 0 ? linearTime : -1
        }

        const discriminant = Math.pow(b, 2) - 4 * a * c
        if (discriminant < 0) return -1

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

        const cosInterceptAngel = (
            Math.pow(this.Distance, 2) +
            Math.pow(TorpedorDistance, 2) -
            Math.pow(this.TargetSpeed * TorpedorTime, 2)
        ) / (2 * this.Distance * TorpedorDistance)

        const clampedCos = Math.min(1, Math.max(-1, cosInterceptAngel))
        const InterceptAngel_radian = Math.acos(clampedCos)
        const InterceptAngel_Degree = InterceptAngel_radian * 180 / Math.PI

        return InterceptAngel_Degree
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

    getDistance(){
        if (
            !Number.isFinite(this.MilReading) ||
            !Number.isFinite(this.TargetRealHight) ||
            this.MilReading <= 0 ||
            this.TargetRealHight <= 0
        ) {
            return NaN
        }
        return this.RangeFactor * (this.TargetRealHight/ this.MilReading)
    }
}


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



*/


