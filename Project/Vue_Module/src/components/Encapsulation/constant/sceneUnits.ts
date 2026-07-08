import * as THREE from 'three'

// -------------------- 模型比例 --------------------

export const MODEL_LENGTH_SCENE = 22

export const MODEL_LENGTH_METERS = 77

export const METERS_TO_SCENE = MODEL_LENGTH_SCENE / MODEL_LENGTH_METERS

export const SCENE_TO_METERS = MODEL_LENGTH_METERS / MODEL_LENGTH_SCENE

// -------------------- 深度 --------------------

export const MAX_DEPTH_METERS = 280

export const MAX_DEPTH_SCENE = MAX_DEPTH_METERS * METERS_TO_SCENE

export const SURFACE_DEPTH_EPSILON_SCENE = 0.02

// -------------------- 垂直速度 --------------------

export const MAX_VERTICAL_SPEED_METERS = 4

export const MAX_VERTICAL_SPEED = MAX_VERTICAL_SPEED_METERS * METERS_TO_SCENE

// -------------------- 水面 / 水下速度 --------------------

export const SURFACE_MAX_SPEED_KMH = 30

export const SUBMERGED_MAX_SPEED_KMH = 13

export const SURFACE_MAX_SPEED = (SURFACE_MAX_SPEED_KMH * 1000 * METERS_TO_SCENE) / 3600

export const SUBMERGED_MAX_SPEED = (SUBMERGED_MAX_SPEED_KMH * 1000 * METERS_TO_SCENE) / 3600

export const REVERSE_SPEED_RATIO = 0.4

// -------------------- 转向 --------------------

export const MAX_TURN_RATE = THREE.MathUtils.degToRad(4)

// -------------------- 深度过渡 --------------------

export const SPEED_TRANSITION_DEPTH_METERS = 15

export const SPEED_TRANSITION_DEPTH = SPEED_TRANSITION_DEPTH_METERS * METERS_TO_SCENE