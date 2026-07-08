// ---- ประกอบภาพสุดท้าย: die-cut + ขอบขาว + trim ----

import { createCanvas, ctx2d, toImageData } from './canvas'
import { enhanceRgb } from './color'

const THRESHOLD = 128

/** แปลง mask (0-255) เป็น binary 0/1 ตาม threshold */
function binarize(mask: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] >= THRESHOLD ? 1 : 0
  return out
}

/**
 * ขยาย (dilate) binary mask ด้วย disk radius r
 * @returns binary mask ใหม่
 */
function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return bin.slice()
  const out = new Uint8Array(w * h)
  // offsets ภายในวงกลมรัศมี r
  const offs: number[] = []
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) offs.push(dx, dy)
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bin[y * w + x]) continue
      // pixel นี้เป็นตัว -> stamp disk
      for (let k = 0; k < offs.length; k += 2) {
        const nx = x + offs[k]
        const ny = y + offs[k + 1]
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        out[ny * w + nx] = 1
      }
    }
  }
  return out
}

/** หา bounding box ของ binary mask (ค่า 1) */
function bbox(bin: Uint8Array, w: number, h: number) {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bin[y * w + x]) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export interface ComposeResult {
  canvas: HTMLCanvasElement
  /** true = mask ว่างเปล่า (ไม่มีตัวสติกเกอร์) */
  empty: boolean
}

/**
 * ประกอบภาพ die-cut พร้อมขอบขาว แล้ว trim ให้พอดีเนื้อหา
 * @param src ภาพต้นฉบับ (สีจริง)
 * @param mask alpha mask (0-255) ขนาดเท่า src
 * @param borderWidth ความหนาขอบขาว (px)
 * @param pad ระยะเว้นขอบโปร่งใสรอบนอก (px)
 * @param trim false = คืนผืนผ้าใบขนาดเท่าต้นฉบับ (ไม่ crop — ใช้กับ manual layout)
 */
export function composeSticker(
  src: ImageBitmap | HTMLCanvasElement,
  mask: Uint8ClampedArray,
  maskW: number,
  maskH: number,
  borderWidth: number,
  pad = 2,
  enhance = 0,
  trim = true,
): ComposeResult {
  const w = maskW
  const h = maskH
  const bin = binarize(mask)
  // geometry ขอบขาว: dilate จาก binary (ขอบนอกคม) — bbox รวมขอบด้วย
  const dil = dilate(bin, w, h, borderWidth)

  let box = bbox(dil, w, h)
  if (!box) {
    return { canvas: createCanvas(2, 2), empty: true }
  }
  if (!trim) {
    box = { x: 0, y: 0, w, h }
    pad = 0
  }

  const srcImg = toImageData(src)
  const sd = srcImg.data

  // ผืนผ้าใบผลลัพธ์ = bbox + pad รอบด้าน
  const outW = box.w + pad * 2
  const outH = box.h + pad * 2
  const out = new ImageData(outW, outH)
  const od = out.data

  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const sx = box.x + x
      const sy = box.y + y
      const sp = sy * w + sx
      const op = ((y + pad) * outW + (x + pad)) * 4

      // subject alpha แบบนุ่ม (จาก mask ตรงๆ -> ขอบ smooth)
      const sa = mask[sp] / 255
      // ฐาน = ขาวถ้าอยู่ในเขต dilation (ขอบขาว), ไม่งั้นโปร่งใส
      const baseA = dil[sp] ? 1 : 0

      if (sa <= 0 && baseA <= 0) continue // โปร่งใส

      const si = sp * 4
      let cr = sd[si], cg = sd[si + 1], cb = sd[si + 2]
      if (enhance > 0) { const e = enhanceRgb(cr, cg, cb, enhance); cr = e[0]; cg = e[1]; cb = e[2] }

      // composite: สีสติกเกอร์ (alpha sa) ทับบนฐานขาว (alpha baseA)
      const outA = sa + baseA * (1 - sa)
      if (outA <= 0) continue
      const wBase = baseA * (1 - sa) // ฐานขาว = 255
      od[op] = Math.round((cr * sa + 255 * wBase) / outA)
      od[op + 1] = Math.round((cg * sa + 255 * wBase) / outA)
      od[op + 2] = Math.round((cb * sa + 255 * wBase) / outA)
      od[op + 3] = Math.round(outA * 255)
    }
  }

  const canvas = createCanvas(outW, outH)
  ctx2d(canvas).putImageData(out, 0, 0)
  return { canvas, empty: false }
}
