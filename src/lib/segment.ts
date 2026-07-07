// ---- แยกชีตรวมเป็นสติกเกอร์ทีละตัว ----
// 2 โหมด: (1) grid R×C  (2) auto-blob จาก alpha mask

import { cropCanvas } from './canvas'

/** โหมดตาราง: หั่นเป็น rows × cols เท่าๆ กัน */
export function sliceGrid(
  src: ImageBitmap | HTMLCanvasElement,
  cols: number,
  rows: number,
): HTMLCanvasElement[] {
  const cellW = Math.floor(src.width / cols)
  const cellH = Math.floor(src.height / rows)
  const out: HTMLCanvasElement[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(cropCanvas(src, c * cellW, r * cellH, cellW, cellH))
    }
  }
  return out
}

export interface Blob2D {
  x: number
  y: number
  w: number
  h: number
  area: number
}

/**
 * หา connected components (4-connectivity) จาก binary mask
 * แล้วคืน bounding box ที่ area >= minAreaRatio ของทั้งภาพ
 */
export function findBlobs(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  minAreaRatio = 0.005,
): Blob2D[] {
  const labels = new Int32Array(w * h).fill(-1)
  const blobs: Blob2D[] = []
  const minArea = Math.max(64, Math.floor(w * h * minAreaRatio))
  const stack: number[] = []

  for (let start = 0; start < w * h; start++) {
    if (mask[start] < 128 || labels[start] !== -1) continue
    // BFS/DFS หนึ่งก้อน
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0
    labels[start] = blobs.length
    stack.length = 0
    stack.push(start)
    while (stack.length) {
      const p = stack.pop()!
      const x = p % w
      const y = (p - x) / w
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const nb = [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        y > 0 ? p - w : -1,
        y < h - 1 ? p + w : -1,
      ]
      for (const np of nb) {
        if (np < 0) continue
        if (mask[np] >= 128 && labels[np] === -1) {
          labels[np] = blobs.length
          stack.push(np)
        }
      }
    }
    blobs.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area })
  }

  return blobs
    .filter((b) => b.area >= minArea)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x)) // เรียงบน->ล่าง, ซ้าย->ขวา
}

/**
 * crop ตาม blob โดยเผื่อ margin เล็กน้อย
 */
export function cropByBlobs(
  src: ImageBitmap | HTMLCanvasElement,
  blobs: Blob2D[],
  margin = 8,
): HTMLCanvasElement[] {
  return blobs.map((b) => {
    const x = Math.max(0, b.x - margin)
    const y = Math.max(0, b.y - margin)
    const w = Math.min(src.width - x, b.w + margin * 2)
    const h = Math.min(src.height - y, b.h + margin * 2)
    return cropCanvas(src, x, y, w, h)
  })
}
