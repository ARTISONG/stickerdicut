import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import { toImageData, createCanvas, ctx2d } from '../lib/canvas'
import { enhanceRgb } from '../lib/color'
import { magicErase, featherMask, erodeMask, DEFAULT_MAGIC } from '../lib/magic'
import { ReframeModal } from './ReframeModal'
import { StickerThumb } from './StickerThumb'
import { NumberField } from './NumberField'

type Tool = 'erase' | 'restore' | 'pick' | 'pan' | 'magic'
const MAX_HISTORY = 10
const VIEW_W = 560
const VIEW_H = 460
const MIN_SCALE = 0.05
const MAX_SCALE = 32
const GHOST_ALPHA = 64
/** ความไวของการซูมด้วยล้อเมาส์ (ยิ่งน้อยยิ่งละเอียด) */
const WHEEL_SENS = 0.0011

// แปลงค่าสไลเดอร์ (0-1000) ↔ scale แบบ log เพื่อให้ปรับได้ละเอียดทั้งช่วง
const sliderToScale = (v: number) => MIN_SCALE * Math.pow(MAX_SCALE / MIN_SCALE, v / 1000)
const scaleToSlider = (s: number) =>
  Math.round((1000 * Math.log(s / MIN_SCALE)) / Math.log(MAX_SCALE / MIN_SCALE))

const toHex = (c: [number, number, number]) =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** กรอบ export คงที่ใน viewport (จัดกึ่งกลาง คงอัตราส่วนขนาด export) */
function fixedFrameView(sw: number, sh: number) {
  const pad = 18
  const aspect = sw / sh
  let fw = VIEW_W - pad * 2
  let fh = fw / aspect
  if (fh > VIEW_H - pad * 2) { fh = VIEW_H - pad * 2; fw = fh * aspect }
  return { x: (VIEW_W - fw) / 2, y: (VIEW_H - fh) / 2, w: fw, h: fh }
}

/** ไอคอนแปรงวงกลม พร้อมเครื่องหมาย - (ลบ) หรือ + (คืนค่า) */
function BrushIcon({ sign, size = 16 }: { sign: '-' | '+'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="7.5" y1="12" x2="16.5" y2="12" />
      {sign === '+' && <line x1="12" y1="7.5" x2="12" y2="16.5" />}
    </svg>
  )
}

export function EditScreen() {
  const selectedId = useStore((s) => s.selectedId)
  const sticker = useStore((s) => s.stickers.find((x) => x.id === selectedId) ?? null)
  const stickerW = useStore((s) => s.stickerW)
  const stickerH = useStore((s) => s.stickerH)
  const frameMargin = useStore((s) => s.frameMargin)
  const { setScreen, setMethod, setTolerance, setChromaColor, setBorder, setEnhance, setLayout, updateMask, recomputeMask, reframe } = useStore()

  const [showReframe, setShowReframe] = useState(false)

  const displayRef = useRef<HTMLCanvasElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const workMask = useRef<Uint8ClampedArray | null>(null)
  const srcImageData = useRef<ImageData | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const view = useRef({ scale: 1, tx: 0, ty: 0 })
  const painting = useRef(false)
  const panning = useRef<{ sx: number; sy: number; tx0: number; ty0: number } | null>(null)
  /** pointer ที่กดค้างอยู่ (สำหรับ pinch zoom บนมือถือ) */
  const pointers = useRef(new Map<number, { vx: number; vy: number }>())
  const pinch = useRef<{ d0: number; scale0: number; cx0: number; cy0: number; tx0: number; ty0: number } | null>(null)
  const spaceHeld = useRef(false)
  const showGhostRef = useRef(true)
  const showFrameRef = useRef(true)
  /** กรอบ export + เขตปลอดภัยในพิกัดภาพต้นฉบับ */
  const frameRef = useRef<{ frame: { x: number; y: number; w: number; h: number }; safe: { x: number; y: number; w: number; h: number } } | null>(null)
  const enhanceRef = useRef(0)
  const strokeSnapshot = useRef<Uint8ClampedArray | null>(null)
  const undoStack = useRef<Uint8ClampedArray[]>([])
  const redoStack = useRef<Uint8ClampedArray[]>([])
  /** โหมดจัดวางในกรอบคงที่ (manual layout) */
  const alignRef = useRef(false)
  const dimsRef = useRef({ w: 370, h: 320, margin: 10 })
  const captureTimer = useRef<number | null>(null)

  const [tool, setTool] = useState<Tool>('erase')
  const [brush, setBrush] = useState(16)
  const [zoomPct, setZoomPct] = useState(100)
  const [showGhost, setShowGhost] = useState(true)
  const [showFrame, setShowFrame] = useState(true)
  const [alignMode, setAlignMode] = useState(false)
  const [magicTol, setMagicTol] = useState(DEFAULT_MAGIC.hueTol)
  const [edgeErode, setEdgeErode] = useState(2)
  const [, setHistTick] = useState(0)
  const bumpHist = () => setHistTick((t) => t + 1)

  const w = sticker?.maskWidth ?? 0
  const h = sticker?.maskHeight ?? 0
  dimsRef.current = { w: stickerW, h: stickerH, margin: frameMargin }

  // ---- สร้าง preview offscreen (die-cut + ghost ภาพต้นฉบับจางๆ) ----
  const buildPreview = useCallback(() => {
    const mask = workMask.current
    const src = srcImageData.current
    if (!mask || !src) { previewRef.current = null; return }
    const iw = src.width, ih = src.height
    let off = previewRef.current
    if (!off || off.width !== iw || off.height !== ih) { off = createCanvas(iw, ih); previewRef.current = off }
    const out = new ImageData(iw, ih)
    const od = out.data, sd = src.data
    const ghostA = showGhostRef.current ? GHOST_ALPHA : 0
    const enh = enhanceRef.current
    for (let p = 0; p < iw * ih; p++) {
      const i = p * 4
      const a = mask[p]
      if (a > 0) {
        // subject (soft alpha) — ใส่ enhancement ให้ตรงกับผลลัพธ์จริง
        let r = sd[i], g = sd[i + 1], b = sd[i + 2]
        if (enh > 0) { const e = enhanceRgb(r, g, b, enh); r = e[0]; g = e[1]; b = e[2] }
        od[i] = r; od[i + 1] = g; od[i + 2] = b; od[i + 3] = a
      } else if (ghostA) {
        od[i] = sd[i]; od[i + 1] = sd[i + 1]; od[i + 2] = sd[i + 2]; od[i + 3] = ghostA
      } else {
        od[i + 3] = 0
      }
    }
    ctx2d(off).putImageData(out, 0, 0)
  }, [])

  // ---- วาด viewport ตาม view (scale/pan) ----
  const renderView = useCallback(() => {
    const canvas = displayRef.current
    if (!canvas) return
    canvas.width = VIEW_W
    canvas.height = VIEW_H
    const ctx = ctx2d(canvas)
    ctx.clearRect(0, 0, VIEW_W, VIEW_H)
    const off = previewRef.current
    if (!off) return
    const { scale, tx, ty } = view.current
    ctx.imageSmoothingEnabled = scale < 2
    ctx.setTransform(scale, 0, 0, scale, tx, ty)
    ctx.drawImage(off, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    // เส้นกรอบภาพ
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'
    ctx.lineWidth = 1
    ctx.strokeRect(tx + 0.5, ty + 0.5, off.width * scale, off.height * scale)
    if (alignRef.current) {
      // โหมดจัดวาง: กรอบ export "คงที่" — รูปเลื่อน/ซูมใต้กรอบ
      const d = dimsRef.current
      const F = fixedFrameView(d.w, d.h)
      // มืดนอกกรอบ (letterbox)
      ctx.save()
      ctx.fillStyle = 'rgba(0,0,0,0.30)'
      ctx.beginPath()
      ctx.rect(0, 0, VIEW_W, VIEW_H)
      ctx.rect(F.x, F.y, F.w, F.h)
      ctx.fill('evenodd')
      ctx.restore()
      // กรอบ export (ฟ้า)
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(20,120,255,0.95)'
      ctx.strokeRect(F.x + 0.5, F.y + 0.5, F.w, F.h)
      // เขตปลอดภัยเว้นขอบ (แดงประ)
      const mx = F.w * (d.margin / d.w)
      const my = F.h * (d.margin / d.h)
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(230,30,30,0.95)'
      ctx.strokeRect(F.x + mx + 0.5, F.y + my + 0.5, F.w - mx * 2, F.h - my * 2)
      ctx.setLineDash([])
      return
    }
    // โหมดอัตโนมัติ: กรอบ export ตามตำแหน่ง bbox ของตัวสติกเกอร์ (เลื่อนตามภาพ)
    const fr = frameRef.current
    if (fr) {
      const vx = (ix: number) => ix * scale + tx
      const vy = (iy: number) => iy * scale + ty
      // กรอบ export (ฟ้า)
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(20,120,255,0.95)'
      ctx.strokeRect(vx(fr.frame.x), vy(fr.frame.y), fr.frame.w * scale, fr.frame.h * scale)
      // เขตปลอดภัยเว้นขอบ (แดงประ)
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(230,30,30,0.95)'
      ctx.strokeRect(vx(fr.safe.x), vy(fr.safe.y), fr.safe.w * scale, fr.safe.h * scale)
      ctx.setLineDash([])
    }
  }, [])

  const fitView = useCallback((iw: number, ih: number) => {
    const pad = 24
    const scale = Math.min((VIEW_W - pad * 2) / iw, (VIEW_H - pad * 2) / ih)
    view.current = { scale, tx: (VIEW_W - iw * scale) / 2, ty: (VIEW_H - ih * scale) / 2 }
    setZoomPct(Math.round(scale * 100))
    renderView()
  }, [renderView])

  // ---- โหมดจัดวาง: บันทึกตำแหน่ง/สเกลปัจจุบันในกรอบคงที่ลง layout (WYSIWYG) ----
  const captureLayout = () => {
    if (!sticker || !alignRef.current) return
    const d = dimsRef.current
    const F = fixedFrameView(d.w, d.h)
    const r = d.w / F.w // view px -> export px
    setLayout(sticker.id, {
      k: view.current.scale * r,
      ox: (view.current.tx - F.x) * r,
      oy: (view.current.ty - F.y) * r,
      frameW: d.w,
      frameH: d.h,
    })
  }
  const captureRef = useRef(captureLayout)
  captureRef.current = captureLayout
  const scheduleCapture = useCallback(() => {
    if (!alignRef.current) return
    if (captureTimer.current) window.clearTimeout(captureTimer.current)
    captureTimer.current = window.setTimeout(() => captureRef.current(), 140)
  }, [])

  // ซูมไปที่ scale เป้าหมาย โดยตรึงจุด (vx,vy) ในหน้าจอไว้กับที่
  const zoomTo = useCallback((targetScale: number, vx: number, vy: number) => {
    const v = view.current
    const ns = clamp(targetScale, MIN_SCALE, MAX_SCALE)
    const k = ns / v.scale
    v.tx = vx - (vx - v.tx) * k
    v.ty = vy - (vy - v.ty) * k
    v.scale = ns
    setZoomPct(Math.round(ns * 100))
    renderView()
    scheduleCapture()
  }, [renderView, scheduleCapture])

  // คำนวณกรอบ export + เขตปลอดภัย ในพิกัดภาพต้นฉบับ (ให้ตรงกับ pipeline export)
  const computeFrame = useCallback(() => {
    const mask = workMask.current
    if (!mask || !showFrameRef.current || !sticker) { frameRef.current = null; return }
    const iw = sticker.maskWidth, ih = sticker.maskHeight
    let minX = iw, minY = ih, maxX = -1, maxY = -1
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        if (mask[y * iw + x] >= 128) {
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) { frameRef.current = null; return }
    const ext = sticker.borderWidth + 2 // border + pad (ตรงกับ composeSticker)
    const bw = (maxX - minX + 1) + ext * 2
    const bh = (maxY - minY + 1) + ext * 2
    const cx = minX + (maxX - minX + 1) / 2
    const cy = minY + (maxY - minY + 1) / 2
    const W = stickerW, H = stickerH
    const m = Math.max(0, Math.min(frameMargin, Math.floor(Math.min(W, H) * 0.4)))
    const availW = W - 2 * m, availH = H - 2 * m
    const s = Math.min(availW / bw, availH / bh) // export px ต่อ source px
    const Wsrc = W / s, Hsrc = H / s
    const swSrc = availW / s, shSrc = availH / s
    frameRef.current = {
      frame: { x: cx - Wsrc / 2, y: cy - Hsrc / 2, w: Wsrc, h: Hsrc },
      safe: { x: cx - swSrc / 2, y: cy - shSrc / 2, w: swSrc, h: shSrc },
    }
  }, [sticker, stickerW, stickerH, frameMargin])

  // อัปเดตกรอบเมื่อ mask/ขอบ/ขนาด/margin เปลี่ยน หรือสลับแสดงกรอบ
  useEffect(() => {
    showFrameRef.current = showFrame
    computeFrame()
    renderView()
  }, [showFrame, sticker?.mask, sticker?.borderWidth, computeFrame, renderView])

  // เตรียม ImageData ต้นฉบับ + fit เมื่อเปลี่ยนสติกเกอร์/แหล่งภาพ (เช่นหลังปรับกรอบ)
  useEffect(() => {
    if (!sticker) return
    srcImageData.current = toImageData(sticker.source)
    fitView(sticker.source.width, sticker.source.height)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sticker?.source])

  // sync โหมดจัดวางเมื่อเปลี่ยนสติกเกอร์ — ถ้ามี layout เดิม ให้กู้ view ให้ตรงตำแหน่งที่จัดไว้
  useEffect(() => {
    const L = sticker?.layout ?? null
    alignRef.current = !!L
    setAlignMode(!!L)
    if (L) {
      const F = fixedFrameView(L.frameW, L.frameH)
      const rv = F.w / L.frameW // export px -> view px
      view.current = { scale: L.k * rv, tx: F.x + L.ox * rv, ty: F.y + L.oy * rv }
      setZoomPct(Math.round(view.current.scale * 100))
      renderView()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sticker?.id])

  // เปิด/ปิดโหมดจัดวางในกรอบ
  function toggleAlign() {
    if (!sticker) return
    if (alignMode) {
      alignRef.current = false
      setAlignMode(false)
      setLayout(sticker.id, null) // กลับไปจัดกึ่งกลางอัตโนมัติ
      setTool('erase')
      renderView()
      return
    }
    alignRef.current = true
    setAlignMode(true)
    setTool('pan') // ลาก = เลื่อนรูปในกรอบ
    const d = dimsRef.current
    const F = fixedFrameView(d.w, d.h)
    if (sticker.layout && sticker.layout.frameW === d.w && sticker.layout.frameH === d.h) {
      // มี layout เดิม -> กู้ตำแหน่ง
      const L = sticker.layout
      const rv = F.w / L.frameW
      view.current = { scale: L.k * rv, tx: F.x + L.ox * rv, ty: F.y + L.oy * rv }
    } else {
      // เริ่มต้น: fit ทั้งภาพลงกรอบ (เว้นขอบตาม margin)
      const iw = sticker.source.width, ih = sticker.source.height
      const mx = F.w * (d.margin / d.w), my = F.h * (d.margin / d.h)
      const s = Math.min((F.w - mx * 2) / iw, (F.h - my * 2) / ih)
      view.current = { scale: s, tx: F.x + (F.w - iw * s) / 2, ty: F.y + (F.h - ih * s) / 2 }
    }
    setZoomPct(Math.round(view.current.scale * 100))
    renderView()
    captureRef.current()
  }

  // sync working mask เมื่อ mask ใน store เปลี่ยน (เช่นหลัง recompute/บันทึกแปรง)
  useEffect(() => {
    if (sticker?.mask) {
      workMask.current = sticker.mask.slice()
      buildPreview()
      renderView()
    } else {
      workMask.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sticker?.mask, sticker?.id])

  // สลับแสดง ghost
  useEffect(() => {
    showGhostRef.current = showGhost
    buildPreview()
    renderView()
  }, [showGhost, buildPreview, renderView])

  // sync ค่า enhance -> อัปเดตพรีวิว
  useEffect(() => {
    enhanceRef.current = sticker?.enhance ?? 0
    buildPreview()
    renderView()
  }, [sticker?.enhance, buildPreview, renderView])

  // ซ่อนวงแหวนแปรงเมื่อเปลี่ยนไปเครื่องมืออื่น
  useEffect(() => {
    if (tool !== 'erase' && tool !== 'restore') hideRing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  // ล้างประวัติ undo/redo เมื่อเปลี่ยนสติกเกอร์/แหล่งภาพ (เช่นหลังปรับกรอบ)
  useEffect(() => {
    undoStack.current = []
    redoStack.current = []
    bumpHist()
  }, [sticker?.id, sticker?.source])

  // wheel zoom (native listener เพื่อ preventDefault ได้) — ซูมตามแรงหมุนจริง ละเอียด/ลื่น
  useEffect(() => {
    const c = displayRef.current
    if (!c) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const rect = c.getBoundingClientRect()
      const vx = (e.clientX - rect.left) * (VIEW_W / rect.width)
      const vy = (e.clientY - rect.top) * (VIEW_H / rect.height)
      // Shift+ล้อ = เลื่อนแนวนอน, ปกติ = ซูม (ตาม deltaY แบบ exponential -> ละเอียด)
      if (e.shiftKey) {
        view.current.tx -= e.deltaY
        renderView()
        return
      }
      const factor = Math.exp(-e.deltaY * WHEEL_SENS)
      zoomTo(view.current.scale * factor, vx, vy)
    }
    c.addEventListener('wheel', handler, { passive: false })
    return () => c.removeEventListener('wheel', handler)
  }, [sticker?.id, sticker?.processing, zoomTo, renderView])

  // Space = pan ชั่วคราว
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeld.current = true }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeld.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // คีย์ลัด undo/redo (Ctrl/Cmd+Z, Ctrl+Y, Ctrl+Shift+Z)
  const undoRef = useRef<() => void>(() => {})
  const redoRef = useRef<() => void>(() => {})
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redoRef.current() : undoRef.current() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redoRef.current() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  function coords(e: React.PointerEvent) {
    const cv = displayRef.current!
    const rect = cv.getBoundingClientRect()
    const vx = (e.clientX - rect.left) * (VIEW_W / rect.width)
    const vy = (e.clientY - rect.top) * (VIEW_H / rect.height)
    const { scale, tx, ty } = view.current
    return { vx, vy, ix: (vx - tx) / scale, iy: (vy - ty) / scale }
  }

  function stamp(mx: number, my: number) {
    const mask = workMask.current
    const src = srcImageData.current
    if (!mask || !src) return
    const iw = src.width, ih = src.height
    const val = tool === 'erase' ? 0 : 255
    const r = brush
    const r2 = r * r
    const x0 = Math.max(0, Math.floor(mx - r))
    const x1 = Math.min(iw - 1, Math.ceil(mx + r))
    const y0 = Math.max(0, Math.floor(my - r))
    const y1 = Math.min(ih - 1, Math.ceil(my + r))
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - mx, dy = y - my
        if (dx * dx + dy * dy <= r2) mask[y * iw + x] = val
      }
    }
  }

  const wantPan = (e: React.PointerEvent) => tool === 'pan' || spaceHeld.current || e.button === 1

  /** ปิดสโตรกที่ค้าง (บันทึกเข้า undo) — ใช้ตอนนิ้วที่สองแตะจอเพื่อเข้าโหมด pinch */
  function commitStroke() {
    if (!painting.current) return
    painting.current = false
    if (workMask.current && sticker) {
      if (strokeSnapshot.current) { pushUndo(strokeSnapshot.current); strokeSnapshot.current = null }
      updateMask(sticker.id, workMask.current.slice())
    }
  }

  function onDown(e: React.PointerEvent) {
    if (!sticker) return
    const { vx, vy, ix, iy } = coords(e)
    pointers.current.set(e.pointerId, { vx, vy })
    try { displayRef.current!.setPointerCapture(e.pointerId) } catch { /* pointer สังเคราะห์ */ }

    // นิ้วที่สอง = เริ่ม pinch zoom (มือถือ)
    if (pointers.current.size === 2) {
      commitStroke()
      panning.current = null
      hideRing()
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        d0: Math.hypot(a.vx - b.vx, a.vy - b.vy) || 1,
        scale0: view.current.scale,
        cx0: (a.vx + b.vx) / 2, cy0: (a.vy + b.vy) / 2,
        tx0: view.current.tx, ty0: view.current.ty,
      }
      return
    }
    if (pinch.current) return // นิ้วที่สามขึ้นไป ไม่สนใจ

    if (wantPan(e)) {
      e.preventDefault()
      panning.current = { sx: vx, sy: vy, tx0: view.current.tx, ty0: view.current.ty }
      return
    }
    if (tool === 'pick') {
      const src = srcImageData.current
      if (src) {
        const px = clamp(Math.floor(ix), 0, src.width - 1)
        const py = clamp(Math.floor(iy), 0, src.height - 1)
        const i = (py * src.width + px) * 4
        setChromaColor(sticker.id, [src.data[i], src.data[i + 1], src.data[i + 2]])
      }
      return
    }
    if (tool === 'magic') { applyMagic(ix, iy); return }
    if (!workMask.current) return
    painting.current = true
    strokeSnapshot.current = workMask.current.slice() // เก็บไว้ทำ undo
    stamp(ix, iy)
    buildPreview()
    renderView()
  }

  // วงแหวน cursor แสดงขนาดแปรงจริง (ตามซูม) เฉพาะแปรงลบ/คืนค่า
  function updateRing(e: React.PointerEvent) {
    const ring = ringRef.current
    const cv = displayRef.current
    if (!ring || !cv) return
    if (tool !== 'erase' && tool !== 'restore') { ring.style.display = 'none'; return }
    const rect = cv.getBoundingClientRect()
    const d = brush * 2 * view.current.scale * (rect.width / VIEW_W)
    ring.style.display = 'block'
    ring.style.width = `${d}px`
    ring.style.height = `${d}px`
    ring.style.left = `${e.clientX - rect.left}px`
    ring.style.top = `${e.clientY - rect.top}px`
    ring.style.borderColor = tool === 'erase' ? 'rgba(230,40,40,0.95)' : 'rgba(30,180,90,0.95)'
  }
  function hideRing() { if (ringRef.current) ringRef.current.style.display = 'none' }
  function onLeave(e: React.PointerEvent) { hideRing(); onUp(e) }

  function onMove(e: React.PointerEvent) {
    const c = coords(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { vx: c.vx, vy: c.vy })

    // pinch zoom สองนิ้ว (มือถือ)
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const p = pinch.current
      const d = Math.hypot(a.vx - b.vx, a.vy - b.vy) || 1
      const cx = (a.vx + b.vx) / 2, cy = (a.vy + b.vy) / 2
      const ns = clamp(p.scale0 * (d / p.d0), MIN_SCALE, MAX_SCALE)
      const k = ns / p.scale0
      view.current.scale = ns
      // ตรึงจุดกึ่งกลางนิ้วไว้กับภาพ + เลื่อนตามนิ้ว
      view.current.tx = cx - (p.cx0 - p.tx0) * k
      view.current.ty = cy - (p.cy0 - p.ty0) * k
      setZoomPct(Math.round(ns * 100))
      renderView()
      scheduleCapture()
      return
    }

    updateRing(e)
    if (panning.current) {
      view.current.tx = panning.current.tx0 + (c.vx - panning.current.sx)
      view.current.ty = panning.current.ty0 + (c.vy - panning.current.sy)
      renderView()
      return
    }
    if (!painting.current) return
    stamp(c.ix, c.iy)
    buildPreview()
    renderView()
  }

  function onUp(e?: React.PointerEvent) {
    if (e) pointers.current.delete(e.pointerId)
    else pointers.current.clear()
    if (pinch.current && pointers.current.size < 2) pinch.current = null
    if (panning.current) { panning.current = null; scheduleCapture(); return }
    commitStroke()
  }

  // ---- ประวัติ undo/redo (สูงสุด 10 เวอร์ชัน) ----
  function pushUndo(prev: Uint8ClampedArray) {
    undoStack.current.push(prev)
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
    redoStack.current = []
    bumpHist()
  }
  function undo() {
    if (!undoStack.current.length || !workMask.current || !sticker) return
    redoStack.current.push(workMask.current.slice())
    const prev = undoStack.current.pop()!
    workMask.current = prev.slice()
    updateMask(sticker.id, prev.slice())
    buildPreview(); renderView(); bumpHist()
  }
  function redo() {
    if (!redoStack.current.length || !workMask.current || !sticker) return
    undoStack.current.push(workMask.current.slice())
    const next = redoStack.current.pop()!
    workMask.current = next.slice()
    updateMask(sticker.id, next.slice())
    buildPreview(); renderView(); bumpHist()
  }

  // ---- Magic erase: จิ้มสีแล้วลบทุกเฉดของโทนนั้นทั้งภาพ ----
  function applyMagic(ix: number, iy: number) {
    const src = srcImageData.current
    const mask = workMask.current
    if (!src || !mask || !sticker) return
    const px = clamp(Math.floor(ix), 0, src.width - 1)
    const py = clamp(Math.floor(iy), 0, src.height - 1)
    const i = (py * src.width + px) * 4
    const target: [number, number, number] = [src.data[i], src.data[i + 1], src.data[i + 2]]
    const snapshot = mask.slice()
    magicErase(src.data, mask, src.width, src.height, px, py, target, {
      ...DEFAULT_MAGIC, hueTol: magicTol, satTol: Math.max(0.3, magicTol / 55),
    })
    pushUndo(snapshot)
    updateMask(sticker.id, mask.slice())
    buildPreview(); renderView()
  }

  // ---- ทำขอบให้เนียน: กัดขอบเข้าเนื้อภาพตาม edgeErode px แล้ว feather ----
  function smoothEdges() {
    const mask = workMask.current
    if (!mask || !sticker) return
    const snapshot = mask.slice()
    if (edgeErode > 0) erodeMask(mask, sticker.maskWidth, sticker.maskHeight, edgeErode)
    featherMask(mask, sticker.maskWidth, sticker.maskHeight, 1 + edgeErode * 0.4)
    pushUndo(snapshot)
    updateMask(sticker.id, mask.slice())
    buildPreview(); renderView()
  }

  // ซูมเข้าหากึ่งกลาง viewport
  const zoomToScale = (s: number) => zoomTo(s, VIEW_W / 2, VIEW_H / 2)
  const zoomStep = (deltaPct: number) => zoomToScale(clamp(zoomPct + deltaPct, MIN_SCALE * 100, MAX_SCALE * 100) / 100)

  undoRef.current = undo
  redoRef.current = redo
  const canUndo = undoStack.current.length > 0
  const canRedo = redoStack.current.length > 0

  if (!sticker) {
    return (
      <div className="panel">
        <h2>ยังไม่ได้เลือกสติกเกอร์</h2>
        <button className="btn-primary" onClick={() => setScreen('manage')}>← กลับไปหน้าจัดการ</button>
      </div>
    )
  }

  const cursor = (tool === 'pan' || spaceHeld.current)
    ? (panning.current ? 'grabbing' : 'grab')
    : (tool === 'erase' || tool === 'restore') ? 'none' // ใช้วงแหวนแทน
    : 'crosshair'

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>✏️ แก้ไข: {sticker.name}</h2>
        <div className="row">
          {sticker.origin && (
            <button className="btn-ghost" onClick={() => setShowReframe(true)}
              title="ปรับกรอบครอปใหม่จากภาพต้นฉบับ (กันหัว/ตัวขาด)">🖼️ ปรับกรอบ</button>
          )}
          <button className="btn-primary" onClick={() => setScreen('manage')}>✔ เสร็จ</button>
        </div>
      </div>

      {showReframe && sticker.origin && (
        <ReframeModal
          origin={sticker.origin}
          exportW={stickerW}
          exportH={stickerH}
          margin={frameMargin}
          onClose={() => setShowReframe(false)}
          onApply={(rect) => { reframe(sticker.id, rect); setShowReframe(false) }}
        />
      )}

      <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
        {/* พื้นที่วาด */}
        <div style={{ flex: '1 1 320px', minWidth: 260, maxWidth: VIEW_W }}>
          {/* แถบ zoom / pan */}
          <div className="row" style={{ marginBottom: 8, gap: 6 }}>
            <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => zoomStep(-1)} title="ซูมออก 1%">➖</button>
            <input type="range" min={0} max={1000} value={scaleToSlider(zoomPct / 100)}
              onChange={(e) => zoomToScale(sliderToScale(+e.target.value))}
              className="m-hide" style={{ width: 120 }} title="ปรับซูมละเอียด" />
            <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => zoomStep(1)} title="ซูมเข้า 1%">➕</button>
            <NumberField value={zoomPct} min={5} max={3200}
              onCommit={(v) => zoomToScale(v / 100)}
              width={62} title="พิมพ์ % ได้ละเอียด 1%" />
            <span className="help">%</span>
            <button className="btn-ghost" style={{ padding: '4px 8px' }}
              onClick={() => fitView(sticker.source.width, sticker.source.height)}>⤢ พอดี</button>
            <button className="btn-ghost" style={{ padding: '4px 8px' }}
              onClick={() => zoomToScale(1)} title="ขนาดจริง 100%">1:1</button>
            <button className={tool === 'pan' ? 'toolbtn active' : 'toolbtn'} style={{ padding: '4px 8px' }}
              onClick={() => setTool(tool === 'pan' ? 'erase' : 'pan')}>✋</button>
            <button className={alignMode ? 'toolbtn active' : 'toolbtn'} style={{ padding: '4px 8px' }}
              onClick={toggleAlign}
              title="จัดวางรูปในกรอบ export เอง — กรอบคงที่ เลื่อน/ซูมรูปเพื่อจัดตำแหน่งและขนาด">🎯 จัดวาง</button>
            <span style={{ width: 1, height: 22, background: 'var(--line)' }} />
            <button className="btn-ghost" style={{ padding: '4px 8px' }} disabled={!canUndo} onClick={undo} title="เลิกทำ (Ctrl+Z)">↶</button>
            <button className="btn-ghost" style={{ padding: '4px 8px' }} disabled={!canRedo} onClick={redo} title="ทำซ้ำ (Ctrl+Y)">↷</button>
            <label className="help" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} />
              ต้นฉบับจางๆ
            </label>
            <label className="help" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={showFrame} onChange={(e) => setShowFrame(e.target.checked)} />
              กรอบ export
            </label>
          </div>

          <div className="checker" style={{ position: 'relative', display: 'block', lineHeight: 0, borderRadius: 8, border: '1px solid var(--line)', width: '100%', maxWidth: VIEW_W, aspectRatio: `${VIEW_W} / ${VIEW_H}`, overflow: 'hidden' }}>
            {sticker.processing
              ? <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}><div className="spin" /></div>
              : <canvas ref={displayRef}
                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                  onPointerEnter={updateRing} onPointerLeave={onLeave}
                  style={{ cursor, touchAction: 'none', width: '100%', height: '100%' }} />}
            {/* วงแหวนแสดงขนาดแปรง */}
            <div ref={ringRef} style={{
              position: 'absolute', left: 0, top: 0, display: 'none',
              width: 0, height: 0, borderRadius: '50%',
              border: '1.5px solid rgba(230,40,40,0.95)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.85), inset 0 0 0 1px rgba(255,255,255,0.85)',
              transform: 'translate(-50%, -50%)', pointerEvents: 'none',
            }} />
          </div>
          <div className="help" style={{ marginTop: 8 }}>
            {tool === 'pick' ? '💧 แตะสีบนภาพเพื่อดูดสีที่จะตัด'
              : tool === 'pan' ? '✋ ลากเพื่อเลื่อนภาพ'
              : tool === 'magic' ? '🪄 จิ้มสีที่ต้องการลบ — ดูดทุกเฉดของโทนนั้น'
              : `ลากเพื่อ${tool === 'erase' ? 'ลบพื้นหลัง' : 'คืนส่วนที่ถูกลบ'}`}
            <span className="m-hide">{tool !== 'pick' && tool !== 'magic' ? ' · ล้อเมาส์=ซูม · Space/ปุ่มกลาง=เลื่อน' : ''}</span>
            <span className="m-only"> · 2 นิ้ว=ซูม/เลื่อน</span>
            {' · '}{w}×{h}px
          </div>
          {alignMode ? (
            <div className="help" style={{ marginTop: 2 }}>
              🎯 <b>โหมดจัดวาง</b> — กรอบ <span style={{ color: 'rgb(20,120,255)', fontWeight: 700 }}>export {stickerW}×{stickerH}</span> คงที่
              · เลื่อน/ซูม<b>รูป</b>เพื่อจัดตำแหน่งและขนาดในกรอบ · สิ่งที่เห็นในกรอบ = ผลลัพธ์ export
              · <span style={{ color: 'rgb(230,30,30)', fontWeight: 700 }}>เส้นแดง = เว้นขอบ {frameMargin}px</span>
            </div>
          ) : showFrame && (
            <div className="help" style={{ marginTop: 2 }}>
              <span style={{ color: 'rgb(20,120,255)', fontWeight: 700 }}>▭ กรอบ export {stickerW}×{stickerH}</span>
              {' · '}
              <span style={{ color: 'rgb(230,30,30)', fontWeight: 700 }}>▭ เขตปลอดภัย (เว้นขอบ {frameMargin}px)</span>
              <span className="m-hide">{' — ตัวสติกเกอร์จะถูกจัดกึ่งกลางในกรอบนี้ตอน export'}</span>
            </div>
          )}
        </div>

        {/* แผงเครื่องมือ */}
        <div style={{ minWidth: 260, flex: 1 }}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>วิธีตัดพื้นหลัง</label>
            <div className="row">
              <button className={sticker.method === 'ai' ? 'toolbtn active' : 'toolbtn'} onClick={() => setMethod(sticker.id, 'ai')}>🤖 AI</button>
              <button className={sticker.method === 'chroma' ? 'toolbtn active' : 'toolbtn'} onClick={() => setMethod(sticker.id, 'chroma')}>🎨 Chroma key</button>
              <button className={sticker.method === 'alpha' ? 'toolbtn active' : 'toolbtn'} onClick={() => setMethod(sticker.id, 'alpha')}>✂️ ตามที่ครอป</button>
              <button className="btn-ghost" onClick={() => recomputeMask(sticker.id)}>↻ ตัดใหม่</button>
            </div>
          </div>

          {sticker.method === 'chroma' && (
            <>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>สีพื้นหลังที่จะตัด</label>
                <div className="row">
                  <button className={tool === 'pick' ? 'toolbtn active' : 'toolbtn'}
                    onClick={() => setTool(tool === 'pick' ? 'erase' : 'pick')}
                    title="เปิดแล้วแตะสีบนภาพเพื่อเลือกสีที่จะตัด">
                    💧 ดูดสี
                  </button>
                  <span title="สีที่จะตัดออก" style={{
                    width: 30, height: 30, borderRadius: 6, border: '1px solid var(--line)',
                    background: sticker.chromaColor ? toHex(sticker.chromaColor) : 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 50%/12px 12px',
                  }} />
                  <input type="color"
                    value={sticker.chromaColor ? toHex(sticker.chromaColor) : '#ff2d87'}
                    onChange={(e) => setChromaColor(sticker.id, fromHex(e.target.value))}
                    style={{ width: 44, height: 32, padding: 2 }} />
                  {sticker.chromaColor && (
                    <button className="btn-ghost" style={{ padding: '4px 8px' }}
                      onClick={() => setChromaColor(sticker.id, null)}>↺ อัตโนมัติ</button>
                  )}
                </div>
                <span className="help">
                  {tool === 'pick'
                    ? '👉 คลิกบนพื้นหลังในภาพเพื่อเลือกสีที่จะตัด'
                    : sticker.chromaColor ? 'ใช้สีที่เลือก' : 'สุ่มสีจากมุมภาพอัตโนมัติ'}
                </span>
              </div>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>ความไว chroma (tolerance): {sticker.chromaTolerance}</label>
                <input type="range" min={4} max={120} value={sticker.chromaTolerance}
                  onChange={(e) => setTolerance(sticker.id, +e.target.value)} />
              </div>
            </>
          )}

          <hr className="hr" />

          <div className="field" style={{ marginBottom: 14 }}>
            <label>เครื่องมือแปรง</label>
            <div className="row">
              <button className={tool === 'erase' ? 'toolbtn active' : 'toolbtn'} onClick={() => setTool('erase')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><BrushIcon sign="-" /> ลบ</button>
              <button className={tool === 'restore' ? 'toolbtn active' : 'toolbtn'} onClick={() => setTool('restore')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><BrushIcon sign="+" /> คืนค่า</button>
              <button className={tool === 'magic' ? 'toolbtn active' : 'toolbtn'} onClick={() => setTool('magic')}>🪄 ลบสีอัตโนมัติ</button>
            </div>
          </div>
          {tool === 'magic' ? (
            <>
              <div className="help" style={{ marginBottom: 8 }}>
                👉 จิ้มสีที่ต้องการลบบนภาพ — ระบบจะดูดทุกเฉดของโทนนั้น (จาง/เข้ม) ออกทั้งภาพ พร้อมเกลี่ยขอบให้เนียน
              </div>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>ความไวของโทนสี: {magicTol}°</label>
                <input type="range" min={6} max={70} value={magicTol} onChange={(e) => setMagicTol(+e.target.value)} />
              </div>
            </>
          ) : (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>ขนาดแปรง: {brush}px</label>
              <input type="range" min={2} max={80} value={brush} onChange={(e) => setBrush(+e.target.value)} />
            </div>
          )}
          <div className="field" style={{ marginBottom: 8 }}>
            <label>กัดขอบเข้าเนื้อภาพ: {edgeErode}px {edgeErode === 0 ? '(เนียนอย่างเดียว)' : ''}</label>
            <input type="range" min={0} max={12} value={edgeErode} onChange={(e) => setEdgeErode(+e.target.value)} />
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn-ghost" onClick={smoothEdges}
              title="กัดขอบเข้าเนื้อภาพตามค่าด้านบน แล้วเกลี่ยขอบให้เนียน">✨ ขอบเนียน/ตัดเงา</button>
            <span className="help m-hide" style={{ alignSelf: 'center' }}>กัดขอบเข้า {edgeErode}px เพื่อตัดเงา/ฟรินจ์</span>
          </div>

          <hr className="hr" />

          <div className="field" style={{ marginBottom: 14 }}>
            <label>ความหนาขอบขาว: {sticker.borderWidth === 0 ? 'ไม่มีขอบ' : `${sticker.borderWidth}px`}</label>
            <input type="range" min={0} max={20} value={sticker.borderWidth}
              onChange={(e) => setBorder(sticker.id, +e.target.value)} />
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label>✨ เพิ่มความสดใสของสี: {Math.round(sticker.enhance * 100)}%</label>
            <input type="range" min={0} max={100} value={Math.round(sticker.enhance * 100)}
              onChange={(e) => setEnhance(sticker.id, +e.target.value / 100)} />
          </div>

          <hr className="hr" />

          <div className="field">
            <label>ตัวอย่างในเฟรม {stickerW}×{stickerH} (เว้นขอบ {frameMargin}px)</label>
            <div className="checker" style={{ width: 132, height: 132 * (stickerH / stickerW), display: 'grid', placeItems: 'center', borderRadius: 8, border: '1px solid var(--line)' }}>
              {!sticker.processing && sticker.mask && (
                <StickerThumb sticker={sticker} width={stickerW} height={stickerH} margin={frameMargin} />
              )}
            </div>
            <span className="help">สติกเกอร์จัดกึ่งกลาง เว้นขอบเท่ากันทุกด้านเพื่อความสมดุล</span>
          </div>

          <div className="help m-hide" style={{ marginTop: 12 }}>
            เคล็ดลับ: ถ้า auto-crop ตัด “หัว/ตัว” ขาด กด <b>🖼️ ปรับกรอบ</b> เพื่อขยายกรอบให้ครบ ·
            ซูม (ล้อเมาส์) + เลื่อน (Space/✋) เพื่อเก็บขอบด้วยแปรง “คืนค่า”
          </div>
        </div>
      </div>

      {/* Floating bar เครื่องมือแปรง + undo/redo (เฉพาะมือถือ) */}
      <div className="float-tools">
        <button className={tool === 'erase' ? 'toolbtn active' : 'toolbtn'}
          onClick={() => setTool('erase')} title="แปรงลบ"><BrushIcon sign="-" size={22} /></button>
        <button className={tool === 'restore' ? 'toolbtn active' : 'toolbtn'}
          onClick={() => setTool('restore')} title="แปรงคืนค่า"><BrushIcon sign="+" size={22} /></button>
        <button className={tool === 'magic' ? 'toolbtn active' : 'toolbtn'}
          onClick={() => setTool('magic')} title="ลบสีอัตโนมัติ (จิ้มสี)">🪄</button>
        <button className={tool === 'pan' ? 'toolbtn active' : 'toolbtn'}
          onClick={() => setTool(tool === 'pan' ? 'erase' : 'pan')} title="เลื่อนภาพ">✋</button>
        <button className="toolbtn" onClick={smoothEdges}
          title={`ทำขอบให้เนียน/ตัดขอบเงา (กัดขอบเข้า ${edgeErode}px)`}>✨</button>
        <span className="sep" />
        <button className="toolbtn" disabled={!canUndo} onClick={undo} title="เลิกทำ">↶</button>
        <button className="toolbtn" disabled={!canRedo} onClick={redo} title="ทำซ้ำ">↷</button>
      </div>
    </div>
  )
}
