// ---- Magic erase: จิ้มสีแล้วลบทุกเฉดของโทนนั้นทั้งภาพ + ทำขอบให้ smooth ----

import { rgbToHsv, hueDist } from './color'

export interface MagicOptions {
  /** ความไวของ hue (องศา) ยิ่งมากยิ่งกินสีกว้าง */
  hueTol: number
  /** ความไวของ saturation (0-1) */
  satTol: number
  /** ความไวของความสว่างสำหรับสีเทา/ขาว/ดำ (0-1) */
  valTol: number
  /** รัศมี feather ทำขอบให้นุ่ม (px) */
  feather: number
}

export const DEFAULT_MAGIC: MagicOptions = { hueTol: 28, satTol: 0.5, valTol: 0.18, feather: 1 }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** เกณฑ์ match ขั้นต่ำที่จะให้ flood ลามต่อไปยังพิกเซลข้างเคียง */
const CONNECT = 0.34

/**
 * ลบพิกเซลโทนสีเดียวกับ target — แต่ "เฉพาะบริเวณที่เชื่อมต่อกับจุดที่กด" (flood fill)
 * ไม่ไปลบสีเดียวกันที่อยู่คนละบริเวณ
 * รองรับสีเดียวกันที่จาง/เข้มต่างกัน แล้ว feather ขอบให้ smooth
 *
 * @param data ImageData.data ของภาพต้นฉบับ (RGBA)
 * @param mask alpha mask (0-255) — จะถูกแก้ไขในตัว
 * @param seedX,seedY จุดเริ่ม (พิกัดในภาพ)
 */
export function magicErase(
  data: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  seedX: number,
  seedY: number,
  target: [number, number, number],
  opt: MagicOptions,
): void {
  const [th, ts, tv] = rgbToHsv(target[0], target[1], target[2])
  const targetIsColored = ts > 0.12

  const matchAt = (p: number): number => {
    const i = p * 4
    const [ph, ps, pv] = rgbToHsv(data[i], data[i + 1], data[i + 2])
    if (targetIsColored) {
      // แมตช์ด้วย hue เดียวกันเป็นหลัก (ลบได้ทั้งเฉดจาง/เข้ม) gate สีเทา/ขาว/ดำ ออก
      const hueScore = clamp01(1 - hueDist(ph, th) / opt.hueTol)
      const satGate = clamp01((ps - 0.1) / 0.1)
      return hueScore * satGate
    }
    // target เป็นสีเทา/ขาว/ดำ: แมตช์ด้วยความอิ่มต่ำ + ความสว่างใกล้กัน
    if (ps < 0.16) return clamp01(1 - Math.abs(pv - tv) / opt.valTol)
    return 0
  }

  const seed = seedY * w + seedX
  const visited = new Uint8Array(w * h)
  const stack = [seed]
  visited[seed] = 1
  while (stack.length) {
    const p = stack.pop()!
    if (mask[p] === 0) continue
    const m = matchAt(p)
    if (m <= 0) continue // ขอบเขต: ไม่ลบ ไม่ลามต่อ
    // ลบแบบนุ่ม
    mask[p] = Math.min(mask[p], Math.round(255 * (1 - m)))
    // ลามต่อเฉพาะพิกเซลที่อยู่ในโทน (match สูงพอ)
    if (m >= CONNECT) {
      const x = p % w
      const nbrs = [
        x > 0 ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        p - w,
        p + w,
      ]
      for (const np of nbrs) {
        if (np >= 0 && np < w * h && !visited[np]) { visited[np] = 1; stack.push(np) }
      }
    }
  }

  if (opt.feather > 0) featherMask(mask, w, h, opt.feather)
}

/**
 * กัดขอบ (erode) เข้าเนื้อภาพด้วย min-filter รัศมี r
 * ใช้ตัดขอบเงา/ฟรินจ์สีที่ไม่ต้องการรอบตัวสติกเกอร์
 */
export function erodeMask(mask: Uint8ClampedArray, w: number, h: number, r: number): void {
  const radius = Math.max(1, Math.round(r))
  const tmp = new Uint8ClampedArray(w * h)
  // แนวนอน: min ในหน้าต่าง [-r, r]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let mn = 255
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = Math.min(w - 1, Math.max(0, x + dx))
        const v = mask[y * w + nx]
        if (v < mn) mn = v
      }
      tmp[y * w + x] = mn
    }
  }
  // แนวตั้ง
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let mn = 255
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = Math.min(h - 1, Math.max(0, y + dy))
        const v = tmp[ny * w + x]
        if (v < mn) mn = v
      }
      mask[y * w + x] = mn
    }
  }
}

/** เกลี่ยขอบ mask ให้นุ่ม (separable box blur เฉพาะบริเวณขอบ) */
export function featherMask(mask: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const r = Math.max(1, Math.round(radius))
  const tmp = new Float32Array(w * h)
  const win = r * 2 + 1
  // แนวนอน
  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -r; x <= r; x++) sum += mask[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win
      const xOut = x - r, xIn = x + r + 1
      sum -= mask[y * w + Math.min(w - 1, Math.max(0, xOut))]
      sum += mask[y * w + Math.min(w - 1, Math.max(0, xIn))]
    }
  }
  // แนวตั้ง
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      mask[y * w + x] = Math.round(sum / win)
      const yOut = y - r, yIn = y + r + 1
      sum -= tmp[Math.min(h - 1, Math.max(0, yOut)) * w + x]
      sum += tmp[Math.min(h - 1, Math.max(0, yIn)) * w + x]
    }
  }
}
