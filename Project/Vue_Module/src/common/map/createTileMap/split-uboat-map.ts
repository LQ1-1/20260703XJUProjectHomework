import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SOURCE_FILE = resolve('/Users/zero/Documents/c_Vue_project/u-boot game/public/maps/uboat-map-1.png')
const OUTPUT_DIR = resolve('/Users/zero/Documents/c_Vue_project/u-boot game/public/maps/tiles')

const MAP_SIZE = 12150
const TILE_SIZE = 450
const TILE_COUNT = MAP_SIZE / TILE_SIZE

interface TileManifestItem {
  column: number
  row: number
  filename: string
  worldX: number
  worldZ: number
  width: number
  height: number
}

async function main(): Promise<void> {
  if (!Number.isInteger(TILE_COUNT)) {
    throw new Error(
      `地图尺寸 ${MAP_SIZE} 无法被瓦片尺寸 ${TILE_SIZE} 整除。`,
    )
  }

  const image = sharp(SOURCE_FILE)
  const metadata = await image.metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error('无法读取地图图片尺寸。')
  }

  if (metadata.width !== MAP_SIZE || metadata.height !== MAP_SIZE) {
    throw new Error(
      [
        `地图尺寸不正确：${metadata.width} × ${metadata.height}`,
        `当前脚本要求：${MAP_SIZE} × ${MAP_SIZE}`,
        '请检查 uboat-map-1.png，或修改脚本中的 MAP_SIZE。',
      ].join('\n'),
    )
  }

  await mkdir(OUTPUT_DIR, { recursive: true })

  const manifest: TileManifestItem[] = []

  for (let row = 0; row < TILE_COUNT; row++) {
    for (let column = 0; column < TILE_COUNT; column++) {
      const filename = `tile_${column}_${row}.png`
      const outputFile = resolve(OUTPUT_DIR, filename)

      await sharp(SOURCE_FILE)
        .extract({
          left: column * TILE_SIZE,
          top: row * TILE_SIZE,
          width: TILE_SIZE,
          height: TILE_SIZE,
        })
        .webp({
          quality: 90,
          effort: 4,
        })
        .toFile(outputFile)

      manifest.push({
        column,
        row,
        filename,
        worldX: column * TILE_SIZE,
        worldZ: row * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      })

      const completed = row * TILE_COUNT + column + 1
      console.log(
        `[${completed}/${TILE_COUNT * TILE_COUNT}] 已生成 ${filename}`,
      )
    }
  }

  await writeFile(
    resolve(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(
      {
        source: 'uboat-map-1.png',
        mapWidth: MAP_SIZE,
        mapHeight: MAP_SIZE,
        tileSize: TILE_SIZE,
        columns: TILE_COUNT,
        rows: TILE_COUNT,
        tiles: manifest,
      },
      null,
      2,
    ),
    'utf8',
  )

  console.log('')
  console.log(`切割完成：${TILE_COUNT} × ${TILE_COUNT} 张瓦片`)
  console.log(`瓦片总数：${TILE_COUNT * TILE_COUNT}`)
  console.log(`输出目录：${OUTPUT_DIR}`)
}

main().catch((error: unknown) => {
  console.error('地图切割失败：')

  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(error)
  }

  process.exitCode = 1
})
