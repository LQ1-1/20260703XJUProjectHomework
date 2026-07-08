import * as THREE from 'three'


export function normalizeDegrees(degrees: number) {

    return ((degrees % 360) + 360) % 360

}

export function yawToCompassDegrees(yaw: number) {

    return normalizeDegrees(90 - THREE.MathUtils.radToDeg(yaw))

}