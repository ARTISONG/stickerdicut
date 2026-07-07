import { useEffect, useRef, useState, useCallback } from 'react'
import type { OriginRef, Rect } from '../types'
import { ctx2d } from '../lib/canvas'

const MAXW = 720
const MAXH = 520
const HIT = 10

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface Props {
  origin: OriginRef
  /** ขนาด export ที่เลือก (ใช้ล็อกอัตราส่วน + คำนวณเส้นเว้นขอบ) */
  exportW: number
  exportH: number
  margin: number
  onApply: (rect: Rect) => void
  onClose: () => void
}

/** ปรับกรอบครอปใหม่จากภาพต้นฉบับ (กันหัว/ตัวขาด) — ล็อกอัตราส่วนตามขนาด export */
export function ReframeModal({ origin, exportW, exportH, margin, onApply, onClose }: Props) {
  const image = origin.image
  const iw = image.width
  const ih = image.height
  const scale = Math.min(MAXW / iw, MAXH / ih, 1)
  const dw = Math.round(iw * scale)
  const dh = Math.round(ih * scale)
  const aspect = exportW / exportH
  const mFracX = margin / exportW // สัดส่วนเว้นขอบตามความกว้าง
  const mFracY = margin / exportH

  const canvasRef = useRef<HTMLCanvasElement>(null)

  // ปรับ rect ให้ได้อัตราส่วน aspect (คงจุดกึ่งกลาง) แล้ว clamp เข้าในภาพ
  const toAspect = useCallback((r: Rect): Rect => {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2
    let w = r.w, h = r.h
    if (w / h > aspect) h = w / aspect
    else w = h * aspect
    // ไม่ให้เกินภาพ
    if (w > iw) { w = iw; h = w / aspect }
    if (h > ih) { h = ih; w = h * aspect }
    let x = cx - w / 2, y = cy - h / 2
    x = Math.max(0, Math.min(iw - w, x))
    y = Math.max(0, Math.min(ih - h, y))
    return { x, y, w, h }
  }, [aspect, iw, ih])

  const [rect, setRect] = useState<Rect>(() => toAspect(origin.rect))
  const drag = useRef<
    | { mode: 'move'; sx: number; sy: number; start: Rect }
    | { mode: 'new'; sx: number; sy: number }
    | { mode: 'resize'; handle: Handle; start: Rect }
    | null
  >(null)

  const handlePos = (r: Rect) => {
    const L = r.x * scale, T = r.y * scale, R = (r.x + r.w) * scale, B = (r.y + r.h) * scale
    const MX = (L + R) / 2, MY = (T + B) / 2
    const map: Record<Handle, [number, number]> = {
      nw: [L, T], n: [MX, T], ne: [R, T], e: [R, MY], se: [R, B], s: [MX, B], sw: [L, B], w: [L, MY],
    }
    return map
  }

  const draw = useCallback((r: Rect) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = dw; canvas.height = dh
    const ctx = ctx2d(canvas)
    ctx.clearRect(0, 0, dw, dh)
    ctx.drawImage(image, 0, 0, dw, dh)
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.fillRect(0, 0, dw, dh)
    const L = r.x * scale, T = r.y * scale, RW = r.w * scale, RH = r.h * scale
    ctx.drawImage(image, r.x, r.y, r.w, r.h, L, T, RW, RH)
    // กรอบครอป (ชมพู)
    ctx.strokeStyle = '#ff2d87'; ctx.lineWidth = 2
    ctx.strokeRect(L + 0.5, T + 0.5, RW, RH)
    // เส้นเว้นขอบ 10px (แดงบางๆ) = พื้นที่ปลอดภัย
    const ix = RW * mFracX, iy = RH * mFracY
    ctx.strokeStyle = 'rgba(230,30,30,0.9)'; ctx.lineWidth = 1
    ctx.setLineDash([5, 3])
    ctx.strokeRect(L + ix + 0.5, T + iy + 0.5, RW - ix * 2, RH - iy * 2)
    ctx.setLineDash([])
    // handles
    const hp = handlePos(r)
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff2d87'; ctx.lineWidth = 1.5
    for (const h of HANDLES) {
      const [x, y] = hp[h]
      ctx.beginPath(); ctx.rect(x - 5, y - 5, 10, 10); ctx.fill(); ctx.stroke()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, dw, dh, scale, mFracX, mFracY])

  useEffect(() => { draw(rect) }, [draw, rect])

  const toDisp = (e: React.PointerEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (dw / r.width), y: (e.clientY - r.top) * (dh / r.height) }
  }

  function hitHandle(px: number, py: number): Handle | null {
    const hp = handlePos(rect)
    for (const h of HANDLES) {
      const [x, y] = hp[h]
      if (Math.abs(px - x) <= HIT && Math.abs(py - y) <= HIT) return h
    }
    return null
  }
  function insideRect(px: number, py: number) {
    const L = rect.x * scale, T = rect.y * scale
    return px >= L && px <= L + rect.w * scale && py >= T && py <= T + rect.h * scale
  }

  function onDown(e: React.PointerEvent) {
    const { x, y } = toDisp(e)
    const h = hitHandle(x, y)
    if (h) drag.current = { mode: 'resize', handle: h, start: rect }
    else if (insideRect(x, y)) drag.current = { mode: 'move', sx: x, sy: y, start: rect }
    else drag.current = { mode: 'new', sx: x, sy: y }
    try { canvasRef.current!.setPointerCapture(e.pointerId) } catch { /* ไม่มี pointer จริง */ }
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const { x, y } = toDisp(e)
    const clampX = (v: number) => Math.max(0, Math.min(iw, v))
    const clampY = (v: number) => Math.max(0, Math.min(ih, v))
    if (d.mode === 'move') {
      const dx = (x - d.sx) / scale, dy = (y - d.sy) / scale
      const nx = Math.max(0, Math.min(iw - d.start.w, d.start.x + dx))
      const ny = Math.max(0, Math.min(ih - d.start.h, d.start.y + dy))
      setRect({ x: nx, y: ny, w: d.start.w, h: d.start.h })
    } else if (d.mode === 'new') {
      const ix = clampX(x / scale), iy = clampY(y / scale)
      const x0 = Math.min(ix, d.sx / scale), y0 = Math.min(iy, d.sy / scale)
      const w = Math.abs(ix - d.sx / scale), h = Math.abs(iy - d.sy / scale)
      setRect(toAspect({ x: x0, y: y0, w: Math.max(4, w), h: Math.max(4, h) }))
    } else {
      // resize — ตรึงมุม/ขอบตรงข้าม แล้วบังคับ aspect + ไม่ล้นภาพ
      const s = d.start
      const anchorX = d.handle.includes('w') ? s.x + s.w : s.x
      const anchorY = d.handle.includes('n') ? s.y + s.h : s.y
      const ix = clampX(x / scale), iy = clampY(y / scale)
      const vertical = d.handle === 'n' || d.handle === 's'
      let w = vertical ? Math.abs(iy - anchorY) * aspect : Math.abs(ix - anchorX)
      let h = w / aspect
      w = Math.max(8, w); h = Math.max(8, h)
      // พื้นที่ว่างจาก anchor ถึงขอบภาพ — ย่อ (คง aspect) ไม่ให้ล้น
      const maxW = d.handle.includes('w') ? anchorX : iw - anchorX
      const maxH = d.handle.includes('n') ? anchorY : ih - anchorY
      const k = Math.min(1, maxW / w, maxH / h)
      w *= k; h *= k
      const nx = d.handle.includes('w') ? anchorX - w : anchorX
      const ny = d.handle.includes('n') ? anchorY - h : anchorY
      setRect({ x: nx, y: ny, w, h })
    }
  }

  function onUp() { drag.current = null }

  const valid = rect.w >= 8 && rect.h >= 8

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100,
      display: 'grid', placeItems: 'center', padding: 20,
    }} onClick={onClose}>
      <div className="panel" style={{ margin: 0, maxWidth: 'none' }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>🖼️ ปรับกรอบครอปจากภาพต้นฉบับ</h2>
          <div className="row">
            <button className="btn-ghost" onClick={() => setRect(toAspect({ x: 0, y: 0, w: iw, h: ih }))}>เต็มภาพ (คงอัตราส่วน)</button>
            <button className="btn-ghost" onClick={onClose}>ยกเลิก</button>
            <button className="btn-primary" disabled={!valid}
              onClick={() => onApply({ x: rect.x, y: rect.y, w: rect.w, h: rect.h })}>ใช้กรอบนี้ →</button>
          </div>
        </div>
        <div className="sub">
          กรอบล็อกอัตราส่วน <b>{exportW}:{exportH}</b> (เท่าขนาด export) · ลากมุม/ขอบเพื่อขยายให้ครอบตัวสติกเกอร์ครบ ·
          <span style={{ color: '#e61e1e' }}> เส้นแดงประ = เขตปลอดภัย เว้นขอบ {margin}px</span> อย่าให้เนื้อหาสำคัญเลยออกไป
        </div>
        <div className="checker" style={{ display: 'inline-block', lineHeight: 0, borderRadius: 8, border: '1px solid var(--line)' }}>
          <canvas ref={canvasRef}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
            style={{ touchAction: 'none', cursor: 'crosshair', maxWidth: '100%', height: 'auto', display: 'block' }} />
        </div>
        <div className="help" style={{ marginTop: 8 }}>กรอบ: {Math.round(rect.w)}×{Math.round(rect.h)} px ที่ ({Math.round(rect.x)}, {Math.round(rect.y)})</div>
      </div>
    </div>
  )
}
