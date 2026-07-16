import { MapCode } from './mapcode'

export interface MapPoint {
  x: number
  z: number
}

export interface VoyageTrackPoint extends MapPoint {
  headingDegrees: number
  sampledAt: number
}

export interface MapRenderOptions {
  canvas: HTMLCanvasElement
  indicatorUrl?: string
  minZoom?: number
  maxZoom?: number
}

const MAP_SIZE = 12150
const TILE_IMAGE_SIZE = 450
const BASE_WORLD_TILE_SIZE = 4050
const DEFAULT_MIN_ZOOM = 0.5
const DEFAULT_MAX_ZOOM = 4.99
const DEFAULT_ZOOM = 1
const INDICATOR_SIZE = 28
const TRACK_ARROW_SIZE = 8

export class MapRender {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly mapCode = new MapCode()
  private readonly imageCache = new Map<string, HTMLImageElement>()
  private readonly minZoom: number
  private readonly maxZoom: number

  private indicatorImage: HTMLImageElement | null = null
  private width = 1
  private height = 1
  private pixelRatio = 1
  private center: MapPoint = { x: 0, z: 0 }
  private zoom = DEFAULT_ZOOM
  private latestTrackPoints: VoyageTrackPoint[] = []

  constructor(options: MapRenderOptions) {
    const context = options.canvas.getContext('2d')
    if (!context) {
      throw new Error('Voyage map canvas 2D context is not available')
    }

    this.canvas = options.canvas
    this.context = context
    this.minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM
    this.maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM

    const indicatorUrl =
      options.indicatorUrl ?? '/assets/BearingDial/hullMapIndicator.png'
    this.indicatorImage = this.loadImage(indicatorUrl)

    this.resize()
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect()
    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    this.canvas.width = Math.round(this.width * this.pixelRatio)
    this.canvas.height = Math.round(this.height * this.pixelRatio)
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0)
    this.render()
  }

  dispose(): void {
    this.imageCache.clear()
    this.indicatorImage = null
  }

  setCenter(center: MapPoint): void {
    this.center = this.clampPoint(center)
    this.render()
  }

  getCenter(): MapPoint {
    return { ...this.center }
  }

  setZoom(zoom: number): void {
    this.zoom = this.clampZoom(zoom)
    this.render()
  }

  getZoom(): number {
    return this.zoom
  }

  zoomBy(delta: number): number {
    const factor = delta < 0 ? 1.12 : 1 / 1.12
    this.setZoom(this.zoom * factor)
    return this.zoom
  }

  panByPixels(deltaX: number, deltaY: number): MapPoint {
    const scale = this.getPixelsPerWorldUnit()
    this.center = this.clampPoint({
      x: this.center.x - deltaX / scale,
      z: this.center.z - deltaY / scale,
    })
    this.render()
    return this.getCenter()
  }

  render(trackPoints?: VoyageTrackPoint[]): void {
    if (trackPoints) {
      this.latestTrackPoints = trackPoints
    }

    const ctx = this.context
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.fillStyle = '#e4ddc3'
    ctx.fillRect(0, 0, this.width, this.height)

    this.drawTiles()
    this.drawTrack(this.latestTrackPoints)
    this.drawIndicator(this.latestTrackPoints.at(-1))
  }

  worldToScreen(point: MapPoint): MapPoint {
    const scale = this.getPixelsPerWorldUnit()
    return {
      x: this.width / 2 + (point.x - this.center.x) * scale,
      z: this.height / 2 + (point.z - this.center.z) * scale,
    }
  }

  private drawTiles(): void {
    const layer = this.mapCode.getTileMapLayer(this.zoom)
    const tileWorldSize = this.getTileWorldSize(layer)
    const tileCount = this.getTileCount(layer)
    const scale = this.getPixelsPerWorldUnit()
    const halfWorldWidth = this.width / 2 / scale
    const halfWorldHeight = this.height / 2 / scale

    const minColumn = Math.max(0, Math.floor((this.center.x - halfWorldWidth) / tileWorldSize))
    const maxColumn = Math.min(
      tileCount - 1,
      Math.floor((this.center.x + halfWorldWidth) / tileWorldSize),
    )
    const minRow = Math.max(0, Math.floor((this.center.z - halfWorldHeight) / tileWorldSize))
    const maxRow = Math.min(
      tileCount - 1,
      Math.floor((this.center.z + halfWorldHeight) / tileWorldSize),
    )

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const image = this.loadImage(this.getTileMapPath(layer, column, row))
        if (!image.complete || image.naturalWidth === 0) continue

        const screen = this.worldToScreen({
          x: column * tileWorldSize,
          z: row * tileWorldSize,
        })
        const drawSize = tileWorldSize * scale
        this.context.drawImage(image, screen.x, screen.z, drawSize, drawSize)
      }
    }
  }

  private drawTrack(trackPoints: VoyageTrackPoint[]): void {
    if (trackPoints.length < 2) return

    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = '#111111'
    ctx.fillStyle = '#111111'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let i = 1; i < trackPoints.length; i += 1) {
      const previousPoint = trackPoints[i - 1]
      const currentPoint = trackPoints[i]
      if (!previousPoint || !currentPoint) continue

      const from = this.worldToScreen(previousPoint)
      const to = this.worldToScreen(currentPoint)

      ctx.beginPath()
      ctx.moveTo(from.x, from.z)
      ctx.lineTo(to.x, to.z)
      ctx.stroke()
      this.drawArrowHead(from, to)
    }

    ctx.restore()
  }

  private drawArrowHead(from: MapPoint, to: MapPoint): void {
    const angle = Math.atan2(to.z - from.z, to.x - from.x)
    if (!Number.isFinite(angle)) return

    const ctx = this.context
    ctx.save()
    ctx.translate(to.x, to.z)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(-TRACK_ARROW_SIZE, TRACK_ARROW_SIZE * 0.55)
    ctx.lineTo(-TRACK_ARROW_SIZE, -TRACK_ARROW_SIZE * 0.55)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private drawIndicator(point: VoyageTrackPoint | undefined): void {
    if (!point || !this.indicatorImage?.complete || this.indicatorImage.naturalWidth === 0) return

    const screen = this.worldToScreen(point)
    const compassToCanvasRotation = (point.headingDegrees * Math.PI) / 180
    const ctx = this.context

    ctx.save()
    ctx.translate(screen.x, screen.z)
    ctx.rotate(compassToCanvasRotation)
    ctx.drawImage(
      this.indicatorImage,
      -INDICATOR_SIZE / 2,
      -INDICATOR_SIZE / 2,
      INDICATOR_SIZE,
      INDICATOR_SIZE,
    )
    ctx.restore()
  }

  private loadImage(url: string): HTMLImageElement {
    const cached = this.imageCache.get(url)
    if (cached) return cached

    const image = new Image()
    image.decoding = 'async'
    image.onload = () => this.render()
    image.src = url
    this.imageCache.set(url, image)
    return image
  }

  private getPixelsPerWorldUnit(): number {
    const layer = this.mapCode.getTileMapLayer(this.zoom)

    if (layer >= 4) {
      const tileWorldSize = this.getTileWorldSize(layer)
      const layerLocalZoom = 0.25 + (this.zoom - layer) * 0.05
      return (TILE_IMAGE_SIZE / tileWorldSize) * layerLocalZoom
    }

    return (TILE_IMAGE_SIZE / BASE_WORLD_TILE_SIZE) * this.zoom
  }

  private getTileWorldSize(layer: number): number {
    if (layer === 0) return 4050
    if (layer === 1) return 1350
    if (layer === 2) return 450
    if (layer === 3) return 150
    return 50
  }

  private getTileCount(layer: number): number {
    if (layer === 0) return 3
    if (layer === 1) return 9
    if (layer === 2) return 27
    if (layer === 3) return 81
    return 243
  }

  private getTileMapPath(layer: number, column: number, row: number): string {
    return `/assets/TileMaps/tiles/${layer}/tile_${column}_${row}.png`
  }

  private clampPoint(point: MapPoint): MapPoint {
    return {
      x: this.clamp(point.x, 0, MAP_SIZE),
      z: this.clamp(point.z, 0, MAP_SIZE),
    }
  }

  private clampZoom(zoom: number): number {
    return this.clamp(zoom, this.minZoom, this.maxZoom)
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
  }
}

export { MapRender as maprender }
