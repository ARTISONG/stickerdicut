// ---- Low-level canvas / ImageData helpers ----

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('ไม่สามารถสร้าง 2D context ได้')
  return ctx
}

/** วาด ImageBitmap/Canvas ลง ImageData */
export function toImageData(
  src: ImageBitmap | HTMLCanvasElement,
): ImageData {
  const w = src.width
  const h = src.height
  const c = createCanvas(w, h)
  const ctx = ctx2d(c)
  ctx.drawImage(src, 0, 0)
  return ctx.getImageData(0, 0, w, h)
}

export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = createCanvas(img.width, img.height)
  ctx2d(c).putImageData(img, 0, 0)
  return c
}

/** โหลดไฟล์รูปเป็น ImageBitmap */
export async function fileToImageBitmap(file: File | Blob): Promise<ImageBitmap> {
  return await createImageBitmap(file)
}

export async function canvasToBlob(
  c: HTMLCanvasElement,
  type = 'image/png',
): Promise<Blob> {
  return await new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob ล้มเหลว'))), type)
  })
}

/** ครอบ (crop) ผืนผ้าใบตามกรอบสี่เหลี่ยม */
export function cropCanvas(
  src: ImageBitmap | HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): HTMLCanvasElement {
  const c = createCanvas(w, h)
  ctx2d(c).drawImage(src, x, y, w, h, 0, 0, w, h)
  return c
}
