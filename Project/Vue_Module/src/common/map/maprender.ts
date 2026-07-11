import * as THREE from 'three'


export class maprender{
    private readonly renderer: THREE.WebGLRenderer
    private readonly scene: THREE.Scene
    private readonly camera: THREE.PerspectiveCamera


    constructor(
        renderer: THREE.WebGLRenderer, 
        scene: THREE.Scene, 
        camera: THREE.PerspectiveCamera){

        this.renderer=renderer
        this.scene=scene
        this.camera=camera    

    }



    excecute(){
        
    }



}










/*
思路：
类似瓦片地图
第一层
第二层
第三层


*/





