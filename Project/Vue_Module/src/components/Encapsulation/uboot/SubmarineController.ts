//封装潜艇类
/*
* 1.潜艇根节点 submarineRoot
* 2.模型视觉节点 submarineVisual
* 3.航向 heading
* 4.速度 currentSpeed
* 5.当前深度 currentDepth
* 6.目标深度 targetDepth
* 7.上浮/下潜
* 8.前进/倒退/转向
* 9.俯仰
* 10.高度跟随海面
*/

import * as THREE from 'three'

import { moveTowards } from '../modules/mathUtils'

import {
    MAX_DEPTH_SCENE,
    MAX_TURN_RATE,
    MAX_VERTICAL_SPEED,
    REVERSE_SPEED_RATIO,
    SCENE_TO_METERS,
    SPEED_TRANSITION_DEPTH,
    SUBMERGED_MAX_SPEED,
    SURFACE_DEPTH_EPSILON_SCENE,
    SURFACE_MAX_SPEED,
    METERS_TO_SCENE,
} from '../constant/sceneUnits'

import { normalizeDegrees, yawToCompassDegrees } from '../modules/navigationMath'


export class SubmarineController {

    public readonly root: THREE.Group
    public readonly visual: THREE.Object3D
    public heading = 0
    public currentSpeed = 0
    public targetDepth = 0
    public currentDepth = 0
    public verticalSpeed = 0
    private movementDelta = new THREE.Vector3()
    private readonly maxPitch = THREE.MathUtils.degToRad(60)
    private readonly pitchResponseSensitivity = 17
    private readonly pitchSmoothing = 1.04
    
    constructor(root: THREE.Group, visual: THREE.Object3D) {

        this.root = root

        this.visual = visual

    }

    get depthMeters() {

        return this.currentDepth * SCENE_TO_METERS

    }

    get speedKmh() {

        return this.currentSpeed * SCENE_TO_METERS * 3.6

    }

    get speedKnots() {

        return this.speedKmh / 1.852

    }

    get positionX() {

        return this.root.position.x

    }

    get positionZ() {

        return this.root.position.z

    }

    isAtSurface() {

        return this.currentDepth <= SURFACE_DEPTH_EPSILON_SCENE

    }

    updateDepth(delta: number, diveInput: number) {

        if (diveInput !== 0) {

            this.targetDepth = THREE.MathUtils.clamp(

                this.targetDepth + diveInput * MAX_VERTICAL_SPEED * delta,

                0,

                MAX_DEPTH_SCENE,

            )

        }

        const difference = this.targetDepth - this.currentDepth

        const desiredVerticalSpeed = THREE.MathUtils.clamp(

            difference * 2,

            -MAX_VERTICAL_SPEED,

            MAX_VERTICAL_SPEED,

        )

        this.verticalSpeed = THREE.MathUtils.damp(

            this.verticalSpeed,

            desiredVerticalSpeed,

            3,

            delta,

        )

        const nextDepth = this.currentDepth + this.verticalSpeed * delta

        if (difference !== 0 && Math.sign(this.targetDepth - nextDepth) !== Math.sign(difference)) {

            this.currentDepth = this.targetDepth

            this.verticalSpeed = 0

        } else {

            this.currentDepth = THREE.MathUtils.clamp(nextDepth, 0, MAX_DEPTH_SCENE)

        }

    }

    updateHorizontalMovement(delta: number, throttle: number, turnInput: number) {

        const maxForwardSpeed = this.currentForwardSpeedLimit()

        const targetSpeed =

            throttle > 0

                ? maxForwardSpeed

                : throttle < 0

                    ? -maxForwardSpeed * REVERSE_SPEED_RATIO

                    : 0

        const requestedSpeedLimit =

            throttle < 0 ? maxForwardSpeed * REVERSE_SPEED_RATIO : maxForwardSpeed

        const currentDirectionLimit =

            this.currentSpeed < 0 ? maxForwardSpeed * REVERSE_SPEED_RATIO : maxForwardSpeed

        const acceleration = requestedSpeedLimit / 12

        const coastDeceleration = currentDirectionLimit / 8

        const isReversing =

            throttle !== 0 &&

            this.currentSpeed !== 0 &&

            Math.sign(targetSpeed) !== Math.sign(this.currentSpeed)

        const rate =

            throttle === 0

                ? coastDeceleration

                : isReversing

                    ? coastDeceleration * 1.5

                    : acceleration

        this.currentSpeed = moveTowards(this.currentSpeed, targetSpeed, rate * delta)

        this.currentSpeed = THREE.MathUtils.clamp(

            this.currentSpeed,

            -maxForwardSpeed * REVERSE_SPEED_RATIO,

            maxForwardSpeed,

        )

        if (turnInput !== 0 && Math.abs(this.currentSpeed) > 0.0001) {

            const directionalLimit =

                this.currentSpeed >= 0 ? maxForwardSpeed : maxForwardSpeed * REVERSE_SPEED_RATIO

            const steeringStrength = THREE.MathUtils.clamp(

                Math.abs(this.currentSpeed) / directionalLimit,

                0,

                1,

            )

            this.heading +=

                turnInput *

                Math.sign(this.currentSpeed) *

                MAX_TURN_RATE *

                steeringStrength *

                delta

            this.root.rotation.y = this.heading

        }

        this.movementDelta.set(

            Math.cos(this.heading) * this.currentSpeed * delta,

            0,

            -Math.sin(this.heading) * this.currentSpeed * delta,

        )

        this.root.position.add(this.movementDelta)

    }

    updateHeight(delta: number, sampledWaterHeight: number) {

        const isAtSurface = this.currentDepth < 0.02

        const targetY = isAtSurface ? sampledWaterHeight : -this.currentDepth

        const followStrength = 1 - Math.exp(-delta * (isAtSurface ? 2.8 : 4))

        this.root.position.y = THREE.MathUtils.lerp(

            this.root.position.y,

            targetY,

            followStrength,

        )

    }

    updatePitch(delta: number) {

        const pitchRange = this.pitchResponseSensitivity * METERS_TO_SCENE

        const pitchIntent = THREE.MathUtils.clamp(

            (this.targetDepth - this.currentDepth) / pitchRange,

            -1,

            1,

        )

        const targetPitch = -pitchIntent * this.maxPitch

        this.visual.rotation.z = THREE.MathUtils.damp(

            this.visual.rotation.z,

            targetPitch,

            this.pitchSmoothing,

            delta,

        )

    }

    private currentForwardSpeedLimit() {

        const depthBlend = THREE.MathUtils.smoothstep(

            this.currentDepth,

            0,

            SPEED_TRANSITION_DEPTH,

        )

        return THREE.MathUtils.lerp(

            SURFACE_MAX_SPEED,

            SUBMERGED_MAX_SPEED,

            depthBlend,

        )

    }

}







