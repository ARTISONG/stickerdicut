// ---- เข้ารหัส APNG จากเฟรม canvas (สำหรับสติกเกอร์/อิโมจิแอนิเมชัน) ----

import UPNG from 'upng-js'
import { setApngLoops, setPngDpi } from './png'

/**
 * รวมเฟรมเป็นไฟล์ APNG (.png)
 * ทุกเฟรมต้องมีขนาดเท่ากัน (renderSticker ให้ขนาดตรงตาม target อยู่แล้ว)
 *
 * @param frames เฟรมเรียงตามลำดับเล่น
 * @param delayMs หน่วงเวลาต่อเฟรม (ms)
 * @param loops จำนวนรอบเล่น (0 = วนไม่จำกัด, LINE ต้องการ 1-4)
 */
export async function encodeApng(
  frames: HTMLCanvasElement[],
  delayMs: number,
  loops: number,
): Promise<Blob> {
  if (frames.length === 0) throw new Error('ไม่มีเฟรม')
  const w = frames[0].width
  const h = frames[0].height
  const bufs: ArrayBuffer[] = frames.map((c) => {
    const d = c.getContext('2d')!.getImageData(0, 0, w, h)
    // คัดลอกเป็น buffer เดี่ยวๆ (กัน offset ของ underlying buffer)
    return d.data.slice().buffer
  })
  const dels = frames.map(() => Math.max(20, Math.round(delayMs)))
  const ab = UPNG.encode(bufs, w, h, 0 /* lossless RGBA */, dels)
  const withLoops = setApngLoops(new Uint8Array(ab), loops)
  // ฝัง 72dpi เหมือน PNG นิ่ง (แทรกหลัง IHDR — ถูกต้องตามลำดับ chunk ของ APNG)
  // withLoops มาจาก .slice() จึงเป็น buffer เดี่ยว offset 0 เสมอ
  return await setPngDpi(new Blob([withLoops.buffer as ArrayBuffer], { type: 'image/png' }), 72)
}
