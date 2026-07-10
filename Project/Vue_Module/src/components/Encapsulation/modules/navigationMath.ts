import * as THREE from 'three'


export function normalizeDegrees(degrees: number) {

    return ((degrees % 360) + 360) % 360

}

export function yawToCompassDegrees(yaw: number) {

    return normalizeDegrees(90 - THREE.MathUtils.radToDeg(yaw))

}

/**
 * 将航向字符串转换为数字度数（0–360）。
 * 接受格式："005°"、"005"、"5°"、"5"、"360°"、"360" 等。
 * 返回规范化的 0–360 数值；无法解析时返回 0。
 */
export function headingStringToDegrees(raw: string): number {
  const cleaned = raw.replace(/[°\s]/g, '')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return 0
  return normalizeDegrees(num)
}