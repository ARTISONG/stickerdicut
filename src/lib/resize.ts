// ---- ปรับขนาดให้พอดีกรอบเป้าหมาย (contain) + เว้นขอบ + บังคับเลขคู่ ----

import { createCanvas, ctx2d } from './canvas'
import { toEven } from '../constants'

/**
 * ปรับภาพให้พอดีกรอบ target แบบ contain (ไม่บิดสัดส่วน) จัดกึ่งกลาง
 * โดยเว้นขอบว่าง (margin) รอบด้านเพื่อความสมดุล
 * ผลลัพธ์เป็นผืนผ้าใบขนาด target (บังคับเลขคู่) พื้นหลังโปร่งใส
 *
 * @param margin ระยะเว้นขอบว่างรอบตัวสติกเกอร์ (px) — ตามไกด์ไลน์ LINE ~10px
 */
export function fitInto(
  src: HTMLCanvasElement | ImageBitmap,
  targetW: number,
  targetH: number,
  margin = 0,
): HTMLCanvasElement {
  const W = toEven(targetW)
  const H = toEven(targetH)
  const c = createCanvas(W, H)
  const ctx = ctx2d(c)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // จำกัด margin ไม่ให้เกินสัดส่วนกรอบ
  const m = Math.max(0, Math.min(margin, Math.floor(Math.min(W, H) * 0.4)))
  const availW = W - m * 2
  const availH = H - m * 2

  // เติมเต็มกรอบ (ยอมขยายภาพให้สมดุล) แต่ไม่บิดสัดส่วน
  const scale = Math.min(availW / src.width, availH / src.height)
  const dw = Math.max(1, Math.round(src.width * scale))
  const dh = Math.max(1, Math.round(src.height * scale))
  const dx = Math.round((W - dw) / 2)
  const dy = Math.round((H - dh) / 2)
  ctx.drawImage(src, dx, dy, dw, dh)
  return c
}
