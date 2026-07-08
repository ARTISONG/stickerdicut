// ---- Core domain types for the Dicut app ----

/** วิธีตัดพื้นหลัง */
export type CutMethod = 'ai' | 'chroma' | 'alpha'

/** สถานะการตรวจสเปกของสติกเกอร์แต่ละตัว */
export interface SpecCheck {
  ok: boolean
  issues: string[]
}

/** ขนาด export (พิกเซล) */
export interface SizePreset {
  id: string
  label: string
  width: number
  height: number
}

/** กรอบสี่เหลี่ยม (พิกเซลในภาพต้นฉบับ) */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** อ้างอิงภาพต้นฉบับก่อนครอป + กรอบที่ครอป (ไว้ปรับกรอบใหม่ภายหลัง) */
export interface OriginRef {
  image: ImageBitmap | HTMLCanvasElement
  rect: Rect
}

/**
 * การจัดวางเอง (manual layout) ในกรอบ export:
 * วาดภาพต้นฉบับ (หลัง die-cut ไม่ trim) ที่ scale k, ตำแหน่ง (ox,oy)
 * บนผืนผ้าใบ frameW×frameH
 */
export interface StickerLayout {
  k: number
  ox: number
  oy: number
  frameW: number
  frameH: number
}

/** สติกเกอร์หนึ่งตัวในชุด */
export interface Sticker {
  id: string
  name: string
  /** ผืนผ้าใบต้นฉบับหลัง crop (ยังมีพื้นหลัง) */
  source: ImageBitmap | HTMLCanvasElement
  /** ภาพต้นฉบับก่อนครอป + กรอบครอป (ไว้ปรับกรอบใหม่ กันหัวขาด) */
  origin: OriginRef | null
  /** วิธีตัดที่เลือก */
  method: CutMethod
  /** ค่า tolerance สำหรับ chroma key (0-255) */
  chromaTolerance: number
  /** สีพื้นหลังที่เลือกเองด้วย eyedropper (RGB) — null = สุ่มจากมุมภาพอัตโนมัติ */
  chromaColor: [number, number, number] | null
  /** ความหนาขอบขาว (px) */
  borderWidth: number
  /** ระดับเพิ่มความสดใสของสี (0 = ปิด, ~1 = สดใสสุด) */
  enhance: number
  /** จัดวางเองในกรอบ export (null = จัดกึ่งกลางอัตโนมัติ) */
  layout: StickerLayout | null
  /**
   * Alpha mask ล่าสุดหลังตัด (Uint8ClampedArray ขนาด w*h, 0-255)
   * ใช้เป็นฐานสำหรับการแต่งด้วยแปรง
   */
  mask: Uint8ClampedArray | null
  maskWidth: number
  maskHeight: number
  /** true = กำลังประมวลผล AI อยู่ */
  processing: boolean
  /** ผลตรวจสเปก (คำนวณตอน export) */
  spec?: SpecCheck
}

/** สถานะทั้งโปรเจกต์ */
export interface ProjectMeta {
  name: string
  /** จำนวนสติกเกอร์ที่ตั้งใจจะมีในชุด */
  targetCount: number
  /** ล็อกแล้ว = ยื่นพิจารณา เปลี่ยนจำนวนไม่ได้ */
  locked: boolean
  /** id ของสติกเกอร์ที่ใช้เป็นรูปหลัก / แท็บ */
  mainStickerId: string | null
  tabStickerId: string | null
}

export type Screen = 'manage' | 'crop' | 'edit' | 'export'
