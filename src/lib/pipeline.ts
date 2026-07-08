// ---- Pipeline: mask -> compose -> resize -> PNG + ตรวจสเปก ----

import type { CutMethod, Sticker, SpecCheck } from '../types'
import { SPEC, toEven } from '../constants'
import { aiCutMask } from './ai'
import { chromaKeyMask } from './chroma'
import { composeSticker } from './compose'
import { fitInto } from './resize'
import { setPngDpi } from './png'
import { canvasToBlob, toImageData } from './canvas'

/** ใช้ alpha channel ที่มีอยู่แล้วในภาพต้นฉบับเป็น mask (สำหรับ crop โปร่งใส/PNG โปร่งใส) */
function alphaMask(
  source: ImageBitmap | HTMLCanvasElement,
): { mask: Uint8ClampedArray; width: number; height: number } {
  const img = toImageData(source)
  const { data, width, height } = img
  const mask = new Uint8ClampedArray(width * height)
  for (let p = 0; p < width * height; p++) mask[p] = data[p * 4 + 3]
  return { mask, width, height }
}

/** คำนวณ base alpha mask ตามวิธีที่เลือก */
export async function computeMask(
  source: ImageBitmap | HTMLCanvasElement,
  method: CutMethod,
  tolerance: number,
  chromaColor?: [number, number, number] | null,
): Promise<{ mask: Uint8ClampedArray; width: number; height: number }> {
  if (method === 'ai') return await aiCutMask(source)
  if (method === 'alpha') return alphaMask(source)
  return chromaKeyMask(source, tolerance, chromaColor)
}

/** เรนเดอร์สติกเกอร์เป็นผืนผ้าใบขนาดเป้าหมาย (die-cut + ขอบขาว + fit + เว้นขอบ) */
export function renderSticker(
  sticker: Sticker,
  targetW: number,
  targetH: number,
  margin = 0,
): HTMLCanvasElement {
  if (!sticker.mask) {
    // ยังไม่มี mask -> คืนผืนผ้าใบว่างขนาดเป้าหมาย
    const c = document.createElement('canvas')
    c.width = toEven(targetW)
    c.height = toEven(targetH)
    return c
  }

  // โหมดจัดวางเอง: วาดภาพ die-cut (ไม่ trim) ตามตำแหน่ง/สเกลที่ผู้ใช้จัดในกรอบ
  if (sticker.layout) {
    const L = sticker.layout
    const composed = composeSticker(
      sticker.source, sticker.mask, sticker.maskWidth, sticker.maskHeight,
      sticker.borderWidth, 0, sticker.enhance, false,
    )
    const fw = toEven(L.frameW)
    const fh = toEven(L.frameH)
    const frame = document.createElement('canvas')
    frame.width = fw
    frame.height = fh
    const ctx = frame.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(composed.canvas, L.ox, L.oy, composed.canvas.width * L.k, composed.canvas.height * L.k)
    if (fw === toEven(targetW) && fh === toEven(targetH)) return frame
    // ขนาดอื่น (main/tab): ย่อทั้งเฟรมลงแบบ contain โดยคงการจัดวางเดิม
    return fitInto(frame, targetW, targetH, 0)
  }

  const composed = composeSticker(
    sticker.source,
    sticker.mask,
    sticker.maskWidth,
    sticker.maskHeight,
    sticker.borderWidth,
    2,
    sticker.enhance,
  )
  return fitInto(composed.canvas, targetW, targetH, margin)
}

/** export เป็น PNG blob พร้อมตั้ง DPI */
export async function exportPng(
  sticker: Sticker,
  targetW: number,
  targetH: number,
  margin = 0,
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = renderSticker(sticker, targetW, targetH, margin)
  let blob = await canvasToBlob(canvas, 'image/png')
  blob = await setPngDpi(blob, SPEC.MIN_DPI)
  return { blob, width: canvas.width, height: canvas.height }
}

/** ตรวจสเปกไฟล์เดียว */
export function checkSpec(blob: Blob, width: number, height: number): SpecCheck {
  const issues: string[] = []
  if (width % 2 !== 0 || height % 2 !== 0) issues.push('ความกว้าง/สูงต้องเป็นเลขคู่')
  if (width > SPEC.STICKER_MAX.width || height > SPEC.STICKER_MAX.height) {
    issues.push(`เกินขนาดสูงสุด ${SPEC.STICKER_MAX.width}×${SPEC.STICKER_MAX.height}`)
  }
  if (blob.size > SPEC.MAX_FILE_BYTES) {
    issues.push(`ไฟล์ใหญ่เกิน 1MB (${(blob.size / 1024 / 1024).toFixed(2)}MB)`)
  }
  if (blob.type !== 'image/png') issues.push('ต้องเป็น PNG')
  return { ok: issues.length === 0, issues }
}
