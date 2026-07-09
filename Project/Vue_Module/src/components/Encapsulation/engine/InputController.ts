/**
 * InputController — 统一键盘/指针输入管理
 *
 * 职责：
 * - 追踪当前按下的按键（WASD 移动、KL 深度、Q 瞄准切换）
 * - 管理潜望镜瞄准时的指针拖拽
 * - 窗口失焦时自动清空按键状态（避免松键在窗口外导致持续移动）
 * - 可编辑目标检测（避免在 input/textarea 中打字时触发游戏操作）
 */
export type GameControlCode = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'KeyK' | 'KeyL' | 'KeyQ'

const CONTROL_CODES = new Set<string>([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyK', 'KeyL', 'KeyQ',
])

export class InputController {
  /** 当前按住的按键集合 */
  readonly pressedKeys = new Set<string>()

  /** 潜望镜拖拽状态 */
  isDraggingPeriscope = false
  lastPeriscopePointerX = 0

  /** 最新的指针 X 变化量（供瞄准控制器使用） */
  periscopePointerDelta = 0
  private _hasNewDelta = false

  private onKeyDown: ((event: KeyboardEvent) => void) | undefined
  private onKeyUp: ((event: KeyboardEvent) => void) | undefined
  private onBlur: (() => void) | undefined

  private onPointerDown: ((event: PointerEvent) => void) | undefined
  private onPointerMove: ((event: PointerEvent) => void) | undefined
  private onPointerUp: ((event: PointerEvent) => void) | undefined

  private domElement: HTMLElement | null = null

  /** 按键动作回调，外部可注入自定义逻辑（例如 Q 触发瞄准切换） */
  onAction?: (code: GameControlCode, pressed: boolean) => void

  /** 附加到 DOM 元素，开始监听键盘和指针事件 */
  attach(domElement: HTMLElement): void {
    this.detach()
    this.domElement = domElement

    this.onKeyDown = (event: KeyboardEvent) => {
      if (!CONTROL_CODES.has(event.code) || this.isEditableTarget(event.target)) return
      event.preventDefault()
      this.pressedKeys.add(event.code)
      this.onAction?.(event.code as GameControlCode, true)
    }
    window.addEventListener('keydown', this.onKeyDown)

    this.onKeyUp = (event: KeyboardEvent) => {
      if (!CONTROL_CODES.has(event.code)) return
      event.preventDefault()
      this.pressedKeys.delete(event.code)
    }
    window.addEventListener('keyup', this.onKeyUp)

    this.onBlur = () => {
      this.pressedKeys.clear()
      this.isDraggingPeriscope = false
    }
    window.addEventListener('blur', this.onBlur)

    // 潜望镜指针事件
    this.onPointerDown = (event: PointerEvent) => {
      this.isDraggingPeriscope = true
      this.lastPeriscopePointerX = event.clientX
      ;(event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId)
    }
    domElement.addEventListener('pointerdown', this.onPointerDown)

    this.onPointerMove = (event: PointerEvent) => {
      if (!this.isDraggingPeriscope) return
      this.periscopePointerDelta = event.clientX - this.lastPeriscopePointerX
      this._hasNewDelta = true
      this.lastPeriscopePointerX = event.clientX
    }
    domElement.addEventListener('pointermove', this.onPointerMove)

    this.onPointerUp = (event: PointerEvent) => {
      if (!this.isDraggingPeriscope) return
      this.isDraggingPeriscope = false
      ;(event.currentTarget as HTMLElement)?.releasePointerCapture?.(event.pointerId)
    }
    domElement.addEventListener('pointerup', this.onPointerUp)
    domElement.addEventListener('pointercancel', this.onPointerUp)
    domElement.addEventListener('pointerleave', this.onPointerUp)
  }

  /** 消费潜望镜指针增量（读取后复位） */
  consumePeriscopeDelta(): number {
    if (!this._hasNewDelta) return 0
    this._hasNewDelta = false
    const d = this.periscopePointerDelta
    this.periscopePointerDelta = 0
    return d
  }

  /** 卸载所有事件监听 */
  detach(): void {
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown)
    if (this.onKeyUp) window.removeEventListener('keyup', this.onKeyUp)
    if (this.onBlur) window.removeEventListener('blur', this.onBlur)
    if (this.domElement) {
      if (this.onPointerDown) this.domElement.removeEventListener('pointerdown', this.onPointerDown)
      if (this.onPointerMove) this.domElement.removeEventListener('pointermove', this.onPointerMove)
      if (this.onPointerUp) {
        this.domElement.removeEventListener('pointerup', this.onPointerUp)
        this.domElement.removeEventListener('pointercancel', this.onPointerUp)
        this.domElement.removeEventListener('pointerleave', this.onPointerUp)
      }
    }
    this.pressedKeys.clear()
    this.isDraggingPeriscope = false
    this.domElement = null
  }

  /** 用户正在输入表单时，不抢占按键 */
  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName.toLowerCase()
    return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select'
  }
}
