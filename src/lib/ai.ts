// ---- AI background removal (@imgly/background-removal) ----
// รันในเบราว์เซอร์ล้วน ผ่าน ONNX/WASM ไม่ต้องมี backend

import { removeBackground } from '@imgly/background-removal'
import { fileToImageBitmap, toImageData } from './canvas'

/**
 * ตัดพื้นหลังด้วย AI แล้วคืน alpha mask
 * @param src ผืนผ้าใบ/บิตแมปต้นฉบับ
 * @returns mask (255 = ตัวสติกเกอร์, 0 = โปร่งใส) พร้อมขนาด
 */
export async function aiCutMask(
  src: ImageBitmap | HTMLCanvasElement,
): Promise<{ mask: Uint8ClampedArray; width: number; height: number }> {
  // แปลงต้นฉบับเป็น blob PNG ก่อนส่งให้ไลบรารี
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = src.width
  srcCanvas.height = src.height
  const sctx = srcCanvas.getContext('2d')!
  sctx.drawImage(src, 0, 0)
  const srcBlob: Blob = await new Promise((res, rej) =>
    srcCanvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob ล้มเหลว'))), 'image/png'),
  )

  const resultBlob = await removeBackground(srcBlob, {
    // ผลลัพธ์เป็น PNG ที่มี alpha แล้ว เราแค่ดึง alpha channel ออกมาเป็น mask
    output: { format: 'image/png' },
  })

  const bmp = await fileToImageBitmap(resultBlob)
  const img = toImageData(bmp)
  const { data, width: w, height: h } = img
  const mask = new Uint8ClampedArray(w * h)
  for (let p = 0; p < w * h; p++) {
    mask[p] = data[p * 4 + 3] // alpha channel
  }
  bmp.close?.()
  return { mask, width: w, height: h }
}
