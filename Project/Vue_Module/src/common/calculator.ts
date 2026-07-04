




class TorpedoFireControlComputerParameter{

    public AOB: number;
    public Distance: number;
    public TargetSpeed: number;
    public TorpedorSpeed: number

    constructor(AOB: number, Distance: number, TargetSpeed: number, TorpedorSpeed: number){
        this.AOB=AOB;
        this.Distance=Distance;
        this.TargetSpeed=TargetSpeed;
        this.TorpedorSpeed=TorpedorSpeed;
    }

    getTime(): number{
        let res=-1;

        let AngleOnBoard=(Math.PI*this.AOB)/(180.0);

        let a=(Math.pow(this.TargetSpeed,2)-Math.pow(this.TorpedorSpeed,2));
        let b=-2*this.TargetSpeed*this.Distance*Math.cos(AngleOnBoard);
        let c=Math.pow(this.Distance,2);


        let time1=(-1*b+Math.sqrt(Math.pow(b,2)-4*a*c))/(2*a);
        let time2=(-1*b-Math.sqrt(Math.pow(b,2)-4*a*c))/(2*a);

        if(time1>=0){
            res=time1;
        }else if(time2>=0){
            res=time2
        }
        return res;
    }

    getTorpedorDistance(): number{
        return this.getTime()*this.TorpedorSpeed;
    }

    getInterceptAngel(): number{
        let TorpedorTime=this.getTime();
        let TorpedorDistance=this.getTorpedorDistance();

        let cosInterceptAngel=(Math.pow(this.Distance,2)+Math.pow(TorpedorDistance,2)-Math.pow(this.TargetSpeed*TorpedorTime,2))/(2*this.Distance*TorpedorDistance);

        let InterceptAngel_radian=Math.acos(cosInterceptAngel);
        let InterceptAngel_Degree=InterceptAngel_radian*180/Math.PI;

        return InterceptAngel_Degree;
    }

}





