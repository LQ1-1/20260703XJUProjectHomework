import * as THREE from 'three'

export class TorpedorController {

    public readonly root: THREE.Group
    public readonly visual: THREE.Object3D
    public heading = 0  //航向
    public currentSpeed = 0    //航速

    public verticalSpeed = 0

    constructor(root: THREE.Group, visual: THREE.Object3D) {
        this.root = root
        this.visual = visual
    }

    getHeading(){
        return this.heading
    }

    setHeading(newHeading: number){
        this.heading=newHeading
    }

    getCurrentSpeed(){
        return this.currentSpeed
    }

    setCurrentSpeed(newSpeed: number){
        this.currentSpeed=newSpeed
    }

    getVerticalSpeed(){
        return this.verticalSpeed
    }

    setVerticalSpeed(newVerticalSpeed: number){
        this.verticalSpeed=newVerticalSpeed
    }

}