// ---- Chroma-key / flood-fill background removal ----
// สร้าง alpha mask จากภาพต้นฉบับ โดยลบพื้นหลังสีเดียว
// ใช้ flood-fill จากขอบภาพเพื่อไม่ให้ลบสีเดียวกันที่อยู่กลางตัวสติกเกอร์

import { toImageData } from './canvas'

/** ระยะห่างสี (euclidean กำลังสอง) */
function colorDist2(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return dr * dr + dg * dg + db * db
}

/** สุ่มสีพื้นหลังจากมุมทั้งสี่ (ค่าเฉลี่ยของ pixel มุม) */
function sampleBackground(img: ImageData): [number, number, number] {
  const { data, width: w, height: h } = img
  const pts = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [0, Math.floor(h / 2)],
    [w - 1, Math.floor(h / 2)], [Math.floor(w / 2), h - 1],
  ]
  let r = 0, g = 0, b = 0
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4
    r += data[i]; g += data[i + 1]; b += data[i + 2]
  }
  const n = pts.length
  return [r / n, g / n, b / n]
}

/**
 * สร้าง alpha mask ด้วย chroma key + flood fill จากขอบ
 * @param bgColor สีพื้นหลังที่จะตัด (RGB) — ถ้าไม่ระบุ จะสุ่มจากมุมภาพอัตโนมัติ
 * @returns Uint8ClampedArray ขนาด w*h (255 = ทึบ/ตัวสติกเกอร์, 0 = โปร่งใส/พื้นหลัง)
 */
export function chromaKeyMask(
  src: ImageBitmap | HTMLCanvasElement,
  tolerance: number,
  bgColor?: [number, number, number] | null,
): { mask: Uint8ClampedArray; width: number; height: number } {
  const img = toImageData(src)
  const { data, width: w, height: h } = img
  const [br, bg, bb] = bgColor ?? sampleBackground(img)
  const tol2 = tolerance * tolerance

  // mask เริ่มต้น = ทุก pixel ทึบ
  const mask = new Uint8ClampedArray(w * h).fill(255)

  // flood fill จากขอบภาพ: pixel ที่เชื่อมต่อกับขอบและสีใกล้พื้นหลัง -> โปร่งใส
  const visited = new Uint8Array(w * h)
  const stack: number[] = []

  const pushIfEdgeBg = (x: number, y: number) => {
    const p = y * w + x
    if (visited[p]) return
    const i = p * 4
    if (colorDist2(data[i], data[i + 1], data[i + 2], br, bg, bb) <= tol2) {
      visited[p] = 1
      mask[p] = 0
      stack.push(p)
    }
  }

  for (let x = 0; x < w; x++) {
    pushIfEdgeBg(x, 0)
    pushIfEdgeBg(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    pushIfEdgeBg(0, y)
    pushIfEdgeBg(w - 1, y)
  }

  while (stack.length) {
    const p = stack.pop()!
    const x = p % w
    const y = (p - x) / w
    const neighbors = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
    ]
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const np = ny * w + nx
      if (visited[np]) continue
      const ni = np * 4
      if (colorDist2(data[ni], data[ni + 1], data[ni + 2], br, bg, bb) <= tol2) {
        visited[np] = 1
        mask[np] = 0
        stack.push(np)
      }
    }
  }

  return { mask, width: w, height: h }
}
