import * as THREE from 'three'

// -------------------- 潜艇模型比例 (Type VII D, 77m) --------------------

export const MODEL_LENGTH_SCENE = 22

export const MODEL_LENGTH_METERS = 77

export const METERS_TO_SCENE = MODEL_LENGTH_SCENE / MODEL_LENGTH_METERS

export const SCENE_TO_METERS = MODEL_LENGTH_METERS / MODEL_LENGTH_SCENE

// -------------------- 货船模型比例 (Liberty Ship, 135m) --------------------

export const CARGO_MODEL_LENGTH_METERS = 370

export const CARGO_MODEL_LENGTH_SCENE = (CARGO_MODEL_LENGTH_METERS / MODEL_LENGTH_METERS) * MODEL_LENGTH_SCENE

/** 货船吃水偏移量：货船船体浸入水中较深，需正向偏移使甲板与水面平齐 */
export const CARGO_SURFACE_MODEL_OFFSET = -6.5


// -------------------- 深度 --------------------

export const MAX_DEPTH_METERS = 280

export const MAX_DEPTH_SCENE = MAX_DEPTH_METERS * METERS_TO_SCENE

export const SURFACE_DEPTH_EPSILON_SCENE = 0.02

/** 货船,潜艇被击沉后要下沉到 该深度 */
export const SINK_DEPTH = 1200

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

export const MAX_TURN_RATE = THREE.MathUtils.degToRad(2.5)

// -------------------- 深度过渡 --------------------

export const SPEED_TRANSITION_DEPTH_METERS = 15

export const SPEED_TRANSITION_DEPTH = SPEED_TRANSITION_DEPTH_METERS * METERS_TO_SCENE

// -------------------- 模型归一化 --------------------

/** 潜艇吃水偏移量，微调使艇体与水面平齐 */
export const SURFACE_MODEL_OFFSET = -0.01

// -------------------- 视觉 --------------------

export const SURFACE_BACKGROUND = new THREE.Color(0x6fb9e8)

export const DEEP_BACKGROUND = new THREE.Color(0x00070d)

//测距公式：（真实船高/垂直密位读数）x 测距系数

export const CARGOSHIP_HIGHT_SCENE = 25.803 //船高25.803（场景单位）

export const RANGE_FACTOR = 139.518 //测距系数


//游戏速度倍率，2026-07-14加入
export const GAME_SPEED_MULTIPLIER = 2
