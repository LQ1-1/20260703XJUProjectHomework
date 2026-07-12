import { createCanvas } from 'canvas'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUTPUT_ROOT = resolve(process.cwd(), 'public/assets/Tile Maps/tiles')

const IMAGE_TILE_SIZE = 450
const FULL_MAP_WORLD_SIZE = 12150
const BASE_CODES = ['AD', 'AE', 'AF', 'AK', 'AL', 'AM', 'BD', 'BE', 'BF']
const CHILD_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

interface TileManifestItem {
  level: number
  column: number
  row: number
  filename: string
  code: string
  worldX: number
  worldZ: number
  worldWidth: number
  worldHeight: number
  imageWidth: number
  imageHeight: number
}

interface LevelConfig {
  level: number
  gridSize: number
  worldTileSize: number
}

const LEVELS: LevelConfig[] = [
  { level: 3, gridSize: 81, worldTileSize: 150 },
  { level: 4, gridSize: 243, worldTileSize: 50 },
]

function getGridCode(column: number, row: number): string {
  const code = CHILD_CODES[row * 3 + column]

  if (!code) {
    throw new Error(`无效的子网格坐标：${column}, ${row}`)
  }

  return code
}

function getBaseCode(column: number, row: number): string {
  const code = BASE_CODES[row * 3 + column]

  if (!code) {
    throw new Error(`无效的基础网格坐标：${column}, ${row}`)
  }

  return code
}

function getTileCode(level: number, column: number, row: number): string {
  const baseDivisor = 3 ** level
  const baseColumn = Math.floor(column / baseDivisor)
  const baseRow = Math.floor(row / baseDivisor)
  const childCodes: string[] = []

  for (let depth = level - 1; depth >= 0; depth--) {
    const divisor = 3 ** depth
    const childColumn = Math.floor((column % (divisor * 3)) / divisor)
    const childRow = Math.floor((row % (divisor * 3)) / divisor)
    childCodes.push(getGridCode(childColumn, childRow))
  }

  return [getBaseCode(baseColumn, baseRow), ...childCodes].join('')
}

function createTilePng(code: string): Buffer {
  const canvas = createCanvas(IMAGE_TILE_SIZE, IMAGE_TILE_SIZE)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = 'rgb(211, 211, 211)'
  ctx.fillRect(0, 0, IMAGE_TILE_SIZE, IMAGE_TILE_SIZE)

  ctx.strokeStyle = 'rgb(80, 80, 80)'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, IMAGE_TILE_SIZE - 3, IMAGE_TILE_SIZE - 3)

  ctx.fillStyle = 'rgb(0, 0, 0)'
  ctx.font = `bold ${code.length > 5 ? 54 : 72}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(code, IMAGE_TILE_SIZE / 2, IMAGE_TILE_SIZE / 2, IMAGE_TILE_SIZE * 0.9)

  return canvas.toBuffer('image/png')
}

async function generateLevel(config: LevelConfig): Promise<void> {
  const outputDir = resolve(OUTPUT_ROOT, String(config.level))
  await mkdir(outputDir, { recursive: true })

  const tiles: TileManifestItem[] = []

  for (let row = 0; row < config.gridSize; row++) {
    for (let column = 0; column < config.gridSize; column++) {
      const code = getTileCode(config.level, column, row)
      const filename = `tile_${column}_${row}.png`
      const outputFile = resolve(outputDir, filename)

      await writeFile(outputFile, createTilePng(code))

      tiles.push({
        level: config.level,
        column,
        row,
        filename,
        code,
        worldX: column * config.worldTileSize,
        worldZ: row * config.worldTileSize,
        worldWidth: config.worldTileSize,
        worldHeight: config.worldTileSize,
        imageWidth: IMAGE_TILE_SIZE,
        imageHeight: IMAGE_TILE_SIZE,
      })
    }
  }

  await writeFile(
    resolve(outputDir, 'manifest.json'),
    JSON.stringify(
      {
        level: config.level,
        mapWidth: FULL_MAP_WORLD_SIZE,
        mapHeight: FULL_MAP_WORLD_SIZE,
        columns: config.gridSize,
        rows: config.gridSize,
        imageTileSize: IMAGE_TILE_SIZE,
        worldTileSize: config.worldTileSize,
        tiles,
      },
      null,
      2,
    ),
    'utf8',
  )

  console.log(
    `第 ${config.level} 层完成：${config.gridSize} × ${config.gridSize}，输出 ${outputDir}`,
  )
}

async function main(): Promise<void> {
  for (const level of LEVELS) {
    await generateLevel(level)
  }
}

main().catch((error: unknown) => {
  console.error('编号瓦片地图生成失败：')

  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(error)
  }

  process.exitCode = 1
})
