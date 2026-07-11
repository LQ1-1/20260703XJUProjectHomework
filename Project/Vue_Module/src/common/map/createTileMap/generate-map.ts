import { createCanvas } from 'canvas'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MapCode } from '../mapcode'

const MAP_SIZE = 1350
const CELL_SIZE = 450
const CELL_COUNT = MAP_SIZE / CELL_SIZE

const canvas = createCanvas(MAP_SIZE, MAP_SIZE)
const ctx = canvas.getContext('2d')

// 整张地图背景
ctx.fillStyle = 'rgb(211, 211, 211)'
ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE)

// 格子样式
ctx.strokeStyle = 'rgb(80, 80, 80)'
ctx.lineWidth = 3

// 文字样式
ctx.fillStyle = 'rgb(0, 0, 0)'
ctx.font = 'bold 72px sans-serif'
ctx.textAlign = 'center'
ctx.textBaseline = 'middle'

let codes:string[] = ['AD', 'AE', 'AF', 'AK', 'AL', 'AM', 'BD', 'BE', 'BF']
let index=0;
for (let row = 0; row < CELL_COUNT; row++) {
  for (let column = 0; column < CELL_COUNT; column++) {
    // X 向右增加，Z 向下增加
    const x = column * CELL_SIZE
    const z = row * CELL_SIZE

    const mapCode = new MapCode(x, z)
    // const text =codes[index];
    // index++
    const text=mapCode.getLocationCode()

    // 当前格子的背景
    ctx.fillStyle = 'rgb(211, 211, 211)'
    ctx.fillRect(x, z, CELL_SIZE, CELL_SIZE)

    // 当前格子的边框
    ctx.strokeStyle = 'rgb(80, 80, 80)'
    ctx.strokeRect(x, z, CELL_SIZE, CELL_SIZE)

    // 当前格子的文字
    ctx.fillStyle = 'rgb(0, 0, 0)'
    ctx.fillText(
      text,
      x + CELL_SIZE / 2,
      z + CELL_SIZE / 2,
      CELL_SIZE * 0.9,
    )
  }
}

// 将 Canvas 编码为 PNG
const pngBuffer = canvas.toBuffer('image/png')

// 输出路径
const outputPath = resolve(process.cwd(), 'uboat-map-0.png')

// 写入磁盘
writeFileSync(outputPath, pngBuffer)

console.log(`地图已经生成：${outputPath}`)
console.log(`图片尺寸：${MAP_SIZE} × ${MAP_SIZE}`)