import type { SizePreset } from './types'

/** ข้อจำกัดตามสเปก LINE Sticker */
export const SPEC = {
  /** dpi ขั้นต่ำ */
  MIN_DPI: 72,
  /** ขนาดไฟล์ต่อรูป (bytes) */
  MAX_FILE_BYTES: 1 * 1024 * 1024, // 1 MB
  /** ขนาด ZIP รวม (bytes) */
  MAX_ZIP_BYTES: 60 * 1024 * 1024, // 60 MB
  /** รูปหลัก */
  MAIN: { width: 240, height: 240 },
  /** รูปแท็บห้องแชท */
  TAB: { width: 96, height: 74 },
  /** ขนาดสติกเกอร์สูงสุดของ LINE */
  STICKER_MAX: { width: 370, height: 320 },
} as const

/** พรีเซ็ตขนาดสติกเกอร์ให้เลือกใน dropdown */
export const SIZE_PRESETS: SizePreset[] = [
  { id: 'line-max', label: 'LINE สูงสุด — 370 × 320', width: 370, height: 320 },
  { id: 'square-320', label: 'จตุรัส — 320 × 320', width: 320, height: 320 },
  { id: 'square-296', label: 'จตุรัส — 296 × 296', width: 296, height: 296 },
  { id: 'square-240', label: 'จตุรัส — 240 × 240', width: 240, height: 240 },
  { id: 'wide-320-240', label: 'แนวนอน — 320 × 240', width: 320, height: 240 },
]

/** ขอบขาวเริ่มต้น (px) */
export const DEFAULT_BORDER = 2

/** ระยะเว้นขอบว่างในเฟรมเริ่มต้น (px) — ไกด์ไลน์ LINE ~10px */
export const DEFAULT_MARGIN = 10

/** tolerance เริ่มต้นของ chroma key */
export const DEFAULT_CHROMA_TOLERANCE = 32

/** ทำให้เป็นเลขคู่ (ปัดขึ้น) */
export function toEven(n: number): number {
  const r = Math.round(n)
  return r % 2 === 0 ? r : r + 1
}
