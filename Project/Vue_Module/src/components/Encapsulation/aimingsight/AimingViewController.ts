import * as THREE from 'three'

import { SCENE_TO_METERS, METERS_TO_SCENE, SURFACE_DEPTH_EPSILON_SCENE } from '../constant/sceneUnits'

import type { SubmarineController } from '../uboot/SubmarineController'

export type AimingViewMode = 'none' | 'surfaceAim' | 'periscope'

export class AimingViewController {

    public mode: AimingViewMode = 'none'

    public periscopeYaw = 0

    public isDragging = false

    private lastPointerX = 0

    private savedCameraPosition = new THREE.Vector3()

    private savedControlsTarget = new THREE.Vector3()

    private hasSavedCamera = false

    private cameraWorldOffset = new THREE.Vector3()

    private readonly periscopeMinDepthMeters = 13

    private readonly periscopeMaxDepthMeters = 15

    private readonly periscopeEyeHeight = 1.05

    private readonly surfaceAimEyeHeight = 2

    private readonly surfaceAimForwardOffset = 3

    private readonly lookDistance = 200

    private readonly mouseSensitivity = 0.004

    get isActive() {

        return this.mode !== 'none'

    }

    isAtPeriscopeDepth(submarine: SubmarineController) {

        const depth = submarine.currentDepth * SCENE_TO_METERS

        return depth >= this.periscopeMinDepthMeters && depth <= this.periscopeMaxDepthMeters

    }

    isAtSurfaceDepth(submarine: SubmarineController) {

        return submarine.currentDepth <= SURFACE_DEPTH_EPSILON_SCENE

    }

    toggle(

        submarine: SubmarineController,

        camera: THREE.PerspectiveCamera,

        controls: { enabled: boolean; autoRotate: boolean; target: THREE.Vector3 },

    ): string | null {

        if (this.isActive) {

            this.disable(camera, controls)

            return null

        }

        const nextMode: AimingViewMode = this.isAtSurfaceDepth(submarine)

            ? 'surfaceAim'

            : this.isAtPeriscopeDepth(submarine)

                ? 'periscope'

                : 'none'

        if (nextMode === 'none') {

            return '请前往水面或潜望镜深度13-15m'

        }

        this.savedCameraPosition.copy(camera.position)

        this.savedControlsTarget.copy(controls.target)

        this.hasSavedCamera = true

        this.mode = nextMode

        this.periscopeYaw = submarine.heading

        controls.enabled = false

        controls.autoRotate = false

        return null

    }

    disable(

        camera: THREE.PerspectiveCamera,

        controls: { enabled: boolean; target: THREE.Vector3 },

    ) {

        this.mode = 'none'

        this.isDragging = false

        if (this.hasSavedCamera) {

            camera.position.copy(this.savedCameraPosition)

            controls.target.copy(this.savedControlsTarget)

            this.hasSavedCamera = false

        }

        controls.enabled = true

    }

    updateValidity(submarine: SubmarineController): string | null {

        if (!this.isActive) return null

        if (this.mode === 'surfaceAim' && !this.isAtSurfaceDepth(submarine)) {

            this.mode = 'none'

            return '请保持水面瞄准深度'

        }

        if (this.mode === 'periscope' && !this.isAtPeriscopeDepth(submarine)) {

            this.mode = 'none'

            return '请前往潜望镜深度13-15m'

        }

        return null

    }

    updateCamera(

        camera: THREE.PerspectiveCamera,

        submarine: SubmarineController,

        sampledWaterHeight: number,

    ) {

        if (!this.isActive) return

        const isSurfaceAim = this.mode === 'surfaceAim'

        const eyeHeight = isSurfaceAim ? this.surfaceAimEyeHeight : this.periscopeEyeHeight

        const forwardOffset = isSurfaceAim ? this.surfaceAimForwardOffset : 0

        this.cameraWorldOffset.set(

            Math.cos(submarine.heading) * forwardOffset,

            0,

            -Math.sin(submarine.heading) * forwardOffset,

        )

        const eyeX = submarine.root.position.x + this.cameraWorldOffset.x

        const eyeY = sampledWaterHeight + eyeHeight

        const eyeZ = submarine.root.position.z + this.cameraWorldOffset.z

        camera.position.set(eyeX, eyeY, eyeZ)

        camera.lookAt(

            eyeX + Math.cos(this.periscopeYaw) * this.lookDistance,

            eyeY,

            eyeZ - Math.sin(this.periscopeYaw) * this.lookDistance,

        )

    }

    handlePointerDown(event: PointerEvent) {

        this.isDragging = true

        this.lastPointerX = event.clientX

    }

    handlePointerMove(event: PointerEvent) {

        if (!this.isDragging) return

        const deltaX = event.clientX - this.lastPointerX

        this.lastPointerX = event.clientX

        this.periscopeYaw -= deltaX * this.mouseSensitivity

    }

    handlePointerUp() {

        this.isDragging = false

    }

}





