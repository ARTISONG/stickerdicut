import { create } from 'zustand'
import type { ApngFrame, CutMethod, OriginRef, ProjectMeta, Rect, Screen, Sticker, StickerLayout } from './types'
import { DEFAULT_BORDER, DEFAULT_CHROMA_TOLERANCE, DEFAULT_MARGIN, SIZE_PRESETS, SPEC, toEven } from './constants'
import { computeMask } from './lib/pipeline'
import { cropCanvas } from './lib/canvas'

/** รายการรูปที่เพิ่มเข้าชุด พร้อมภาพต้นฉบับ (ถ้ามี) */
export interface SourceItem {
  source: ImageBitmap | HTMLCanvasElement
  origin?: OriginRef
}

let seq = 0
const uid = () => `stk_${Date.now().toString(36)}_${(seq++).toString(36)}`

interface State {
  meta: ProjectMeta
  stickers: Sticker[]
  screen: Screen
  selectedId: string | null
  /** ขนาด export ของสติกเกอร์แต่ละตัว (พิกเซล) */
  stickerW: number
  stickerH: number
  /** ความหนาขอบขาวเริ่มต้นสำหรับสติกเกอร์ใหม่ (px, 0 = ไม่มีขอบ) */
  defaultBorder: number
  /** ระยะเว้นขอบว่างในเฟรม export (px) — ตามไกด์ไลน์ LINE ~10px */
  frameMargin: number
  /** ขนาดรูปหลัก (main) */
  mainW: number
  mainH: number
  /** ขนาดรูปแท็บ (tab) */
  tabW: number
  tabH: number
  /** รูปที่รอครอปแบบ free-form */
  cropQueue: (ImageBitmap | HTMLCanvasElement)[]
  /** ความคืบหน้าการตัด AI ทั้งชุด */
  aiBatch: { done: number; total: number } | null
  /** กล่องเฟรมของเครื่องมือ APNG (เริ่ม 4 กล่อง, สูงสุด 20) */
  apngFrames: ApngFrame[]
  /** ขนาดผืนผ้าใบ APNG */
  apngW: number
  apngH: number
  /** หน่วงเวลาต่อเฟรม (ms) และจำนวนรอบเล่น */
  apngDelay: number
  apngLoops: number

  setScreen: (s: Screen) => void
  setName: (name: string) => void
  setTargetCount: (n: number) => void
  toggleLock: () => void
  setStickerSize: (w: number, h: number) => void
  setDefaultBorder: (w: number) => void
  setFrameMargin: (m: number) => void
  setMainSize: (w: number, h: number) => void
  setTabSize: (w: number, h: number) => void

  addSources: (items: SourceItem[], method?: CutMethod) => void
  reframe: (id: string, rect: Rect) => void
  removeSticker: (id: string) => void
  selectSticker: (id: string | null) => void
  openEditor: (id: string) => void

  startCrop: (images: (ImageBitmap | HTMLCanvasElement)[]) => void
  clearCropQueue: () => void

  setMethod: (id: string, method: CutMethod) => void
  setTolerance: (id: string, tol: number) => void
  setChromaColor: (id: string, color: [number, number, number] | null) => void
  setBorder: (id: string, w: number) => void
  setEnhance: (id: string, v: number) => void
  setLayout: (id: string, layout: StickerLayout | null) => void
  updateMask: (id: string, mask: Uint8ClampedArray) => void
  recomputeMask: (id: string) => Promise<void>
  aiCutAll: () => Promise<void>

  setMain: (id: string) => void
  setTab: (id: string) => void

  apngAddSlot: () => void
  /** ลบกล่อง (ถ้าเหลือ 4 กล่อง จะล้างรูปแทนการลบกล่อง) */
  apngRemoveSlot: (id: string) => void
  /** เติมรูปตั้งแต่กล่อง startId ไล่ไปกล่องว่างถัดไป (เพิ่มกล่องใหม่ให้ถ้าจำเป็น ≤20) */
  apngFillImages: (startId: string, items: { image: ImageBitmap; name: string; bbox: Rect }[]) => void
  apngSetManual: (id: string, t: { k: number; ox: number; oy: number } | null) => void
  apngSetSize: (w: number, h: number) => void
  apngSetDelay: (d: number) => void
  apngSetLoops: (l: number) => void
}

const APNG_MIN_SLOTS = 4
const APNG_MAX_SLOTS = 20
const makeSlot = (): ApngFrame => ({ id: uid(), image: null, name: '', bbox: null, manual: null })

const initialMeta: ProjectMeta = {
  name: 'dicut-stickers',
  targetCount: 8,
  locked: false,
  mainStickerId: null,
  tabStickerId: null,
}

export const useStore = create<State>((set, get) => ({
  meta: initialMeta,
  stickers: [],
  screen: 'manage',
  selectedId: null,
  stickerW: SIZE_PRESETS[0].width,
  stickerH: SIZE_PRESETS[0].height,
  defaultBorder: DEFAULT_BORDER,
  frameMargin: DEFAULT_MARGIN,
  mainW: SPEC.MAIN.width,
  mainH: SPEC.MAIN.height,
  tabW: SPEC.TAB.width,
  tabH: SPEC.TAB.height,
  cropQueue: [],
  aiBatch: null,
  apngFrames: Array.from({ length: APNG_MIN_SLOTS }, makeSlot),
  apngW: 320,
  apngH: 270,
  apngDelay: 125,
  apngLoops: 4,

  setScreen: (screen) => set({ screen }),
  setName: (name) => set((s) => ({ meta: { ...s.meta, name } })),
  setTargetCount: (n) =>
    set((s) =>
      s.meta.locked ? s : { meta: { ...s.meta, targetCount: Math.max(1, n) } },
    ),
  toggleLock: () => set((s) => ({ meta: { ...s.meta, locked: !s.meta.locked } })),
  setStickerSize: (w, h) => set({ stickerW: toEven(w), stickerH: toEven(h) }),
  setDefaultBorder: (w) => set({ defaultBorder: Math.max(0, w) }),
  setFrameMargin: (m) => set({ frameMargin: Math.max(0, m) }),
  setMainSize: (w, h) => set({ mainW: toEven(w), mainH: toEven(h) }),
  setTabSize: (w, h) => set({ tabW: toEven(w), tabH: toEven(h) }),

  startCrop: (images) => set({ cropQueue: images, screen: 'crop' }),
  clearCropQueue: () => set({ cropQueue: [] }),

  addSources: (items, method = 'chroma') => {
    const border = get().defaultBorder
    const newOnes: Sticker[] = items.map((it, i) => ({
      id: uid(),
      name: `สติกเกอร์ ${get().stickers.length + i + 1}`,
      source: it.source,
      origin: it.origin ?? null,
      method,
      chromaTolerance: DEFAULT_CHROMA_TOLERANCE,
      chromaColor: null,
      borderWidth: border,
      enhance: 0,
      layout: null,
      mask: null,
      maskWidth: it.source.width,
      maskHeight: it.source.height,
      processing: true,
    }))
    set((s) => {
      const meta = { ...s.meta }
      if (!meta.mainStickerId && newOnes[0]) meta.mainStickerId = newOnes[0].id
      if (!meta.tabStickerId && newOnes[0]) meta.tabStickerId = newOnes[0].id
      return { stickers: [...s.stickers, ...newOnes], meta }
    })
    // เริ่มคำนวณ mask ให้ทุกตัวใหม่ (ทีละตัวเพื่อไม่ให้แย่ง CPU)
    ;(async () => {
      for (const stk of newOnes) {
        await get().recomputeMask(stk.id)
      }
    })()
  },

  removeSticker: (id) =>
    set((s) => {
      const meta = { ...s.meta }
      if (meta.mainStickerId === id) meta.mainStickerId = null
      if (meta.tabStickerId === id) meta.tabStickerId = null
      return {
        stickers: s.stickers.filter((x) => x.id !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
        meta,
      }
    }),

  selectSticker: (id) => set({ selectedId: id }),
  openEditor: (id) => set({ selectedId: id, screen: 'edit' }),

  reframe: (id, rect) => {
    const stk = get().stickers.find((x) => x.id === id)
    if (!stk?.origin) return
    const x = Math.max(0, Math.round(rect.x))
    const y = Math.max(0, Math.round(rect.y))
    const w = Math.max(1, Math.round(rect.w))
    const h = Math.max(1, Math.round(rect.h))
    const src = cropCanvas(stk.origin.image, x, y, w, h)
    set((s) => ({
      stickers: s.stickers.map((z) =>
        z.id === id
          ? { ...z, source: src, maskWidth: w, maskHeight: h, mask: null, processing: true,
              layout: null,
              origin: { image: stk.origin!.image, rect: { x, y, w, h } } }
          : z,
      ),
    }))
    get().recomputeMask(id)
  },

  setMethod: (id, method) => {
    set((s) => ({
      stickers: s.stickers.map((x) => (x.id === id ? { ...x, method } : x)),
    }))
    get().recomputeMask(id)
  },

  setTolerance: (id, tol) => {
    set((s) => ({
      stickers: s.stickers.map((x) =>
        x.id === id ? { ...x, chromaTolerance: tol } : x,
      ),
    }))
    const stk = get().stickers.find((x) => x.id === id)
    if (stk?.method === 'chroma') get().recomputeMask(id)
  },

  setChromaColor: (id, color) => {
    set((s) => ({
      stickers: s.stickers.map((x) => (x.id === id ? { ...x, chromaColor: color } : x)),
    }))
    const stk = get().stickers.find((x) => x.id === id)
    if (stk?.method === 'chroma') get().recomputeMask(id)
  },

  setBorder: (id, w) =>
    set((s) => ({
      stickers: s.stickers.map((x) =>
        x.id === id ? { ...x, borderWidth: Math.max(0, w) } : x,
      ),
    })),

  setEnhance: (id, v) =>
    set((s) => ({
      stickers: s.stickers.map((x) =>
        x.id === id ? { ...x, enhance: Math.max(0, Math.min(1, v)) } : x,
      ),
    })),

  setLayout: (id, layout) =>
    set((s) => ({
      stickers: s.stickers.map((x) => (x.id === id ? { ...x, layout } : x)),
    })),

  updateMask: (id, mask) =>
    set((s) => ({
      stickers: s.stickers.map((x) => (x.id === id ? { ...x, mask } : x)),
    })),

  recomputeMask: async (id) => {
    const stk = get().stickers.find((x) => x.id === id)
    if (!stk) return
    set((s) => ({
      stickers: s.stickers.map((x) => (x.id === id ? { ...x, processing: true } : x)),
    }))
    try {
      const { mask, width, height } = await computeMask(
        stk.source,
        stk.method,
        stk.chromaTolerance,
        stk.chromaColor,
      )
      set((s) => ({
        stickers: s.stickers.map((x) =>
          x.id === id
            ? { ...x, mask, maskWidth: width, maskHeight: height, processing: false }
            : x,
        ),
      }))
    } catch (e) {
      console.error('recomputeMask ล้มเหลว', e)
      set((s) => ({
        stickers: s.stickers.map((x) =>
          x.id === id ? { ...x, processing: false } : x,
        ),
      }))
    }
  },

  aiCutAll: async () => {
    const ids = get().stickers.map((s) => s.id)
    set({ aiBatch: { done: 0, total: ids.length } })
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      // เปลี่ยนวิธีเป็น AI แล้วคำนวณใหม่ทีละตัว (เห็น progress)
      set((s) => ({
        stickers: s.stickers.map((x) => (x.id === id ? { ...x, method: 'ai' } : x)),
      }))
      await get().recomputeMask(id)
      set({ aiBatch: { done: i + 1, total: ids.length } })
    }
    set({ aiBatch: null })
  },

  setMain: (id) => set((s) => ({ meta: { ...s.meta, mainStickerId: id } })),
  setTab: (id) => set((s) => ({ meta: { ...s.meta, tabStickerId: id } })),

  apngAddSlot: () =>
    set((s) =>
      s.apngFrames.length >= APNG_MAX_SLOTS ? s : { apngFrames: [...s.apngFrames, makeSlot()] },
    ),

  apngRemoveSlot: (id) =>
    set((s) => {
      if (s.apngFrames.length > APNG_MIN_SLOTS) {
        return { apngFrames: s.apngFrames.filter((f) => f.id !== id) }
      }
      // เหลือขั้นต่ำ -> ล้างรูปในกล่องแทน
      return {
        apngFrames: s.apngFrames.map((f) =>
          f.id === id ? { ...f, image: null, name: '', bbox: null, manual: null } : f,
        ),
      }
    }),

  apngFillImages: (startId, items) =>
    set((s) => {
      const frames = s.apngFrames.map((f) => ({ ...f }))
      let idx = frames.findIndex((f) => f.id === startId)
      if (idx < 0) idx = 0
      let first = true
      for (const it of items) {
        if (!first) {
          // รูปถัดไป: หากล่องว่างตั้งแต่ตำแหน่งปัจจุบัน ไม่มีก็เพิ่มกล่องใหม่ (≤20)
          while (idx < frames.length && frames[idx].image) idx++
          if (idx >= frames.length) {
            if (frames.length >= APNG_MAX_SLOTS) break
            frames.push(makeSlot())
          }
        }
        frames[idx] = { ...frames[idx], image: it.image, name: it.name, bbox: it.bbox, manual: null }
        idx++
        first = false
      }
      return { apngFrames: frames }
    }),

  apngSetManual: (id, t) =>
    set((s) => ({
      apngFrames: s.apngFrames.map((f) => (f.id === id ? { ...f, manual: t } : f)),
    })),

  apngSetSize: (w, h) => set({ apngW: toEven(w), apngH: toEven(h) }),
  apngSetDelay: (d) => set({ apngDelay: Math.max(20, d) }),
  apngSetLoops: (l) => set({ apngLoops: Math.max(0, Math.min(4, l)) }),
}))
