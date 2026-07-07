import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import { createCanvas, ctx2d } from '../lib/canvas'

interface Pt { x: number; y: number }
const MAX_DISPLAY = 760

/** หน้าครอปแบบ free-form (lasso): ลากวาดกรอบรอบสติกเกอร์แต่ละตัวเอง */
export function CropStudio() {
  const images = useStore((s) => s.cropQueue)
  const defaultBorder = useStore((s) => s.defaultBorder)
  const { addSources, clearCropQueue, setScreen, setDefaultBorder } = useStore()

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [points, setPoints] = useState<Pt[]>([])
  const drawing = useRef(false)
  const [crops, setCrops] = useState<{ canvas: HTMLCanvasElement; from: number; rect: { x: number; y: number; w: number; h: number } }[]>([])

  const img = images[activeIdx]
  const scale = img ? Math.min(MAX_DISPLAY / img.width, MAX_DISPLAY / img.height, 1) : 1
  const dispW = img ? Math.round(img.width * scale) : 0
  const dispH = img ? Math.round(img.height * scale) : 0

  const redraw = useCallback((pts: Pt[]) => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    canvas.width = dispW
    canvas.height = dispH
    const ctx = ctx2d(canvas)
    ctx.clearRect(0, 0, dispW, dispH)
    ctx.drawImage(img, 0, 0, dispW, dispH)
    if (pts.length > 1) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255,45,135,0.18)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ff2d87'
      ctx.setLineDash([6, 4])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [img, dispW, dispH])

  useEffect(() => { redraw([]) ; setPoints([]) }, [redraw, activeIdx])

  function pt(e: React.PointerEvent): Pt {
    const cv = canvasRef.current!
    const r = cv.getBoundingClientRect()
    // แปลงพิกัดหน้าจอ -> พิกัดภายใน canvas (เผื่อกรณี canvas ถูกย่อด้วย CSS)
    const sx = cv.width / r.width
    const sy = cv.height / r.height
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }
  function onDown(e: React.PointerEvent) {
    drawing.current = true
    canvasRef.current!.setPointerCapture(e.pointerId)
    const p = [pt(e)]
    setPoints(p); redraw(p)
  }
  function onMove(e: React.PointerEvent) {
    if (!drawing.current) return
    setPoints((prev) => { const next = [...prev, pt(e)]; redraw(next); return next })
  }
  function onUp() {
    if (!drawing.current) return
    drawing.current = false
    finalize()
  }

  function finalize() {
    if (points.length < 3 || !img) { setPoints([]); redraw([]); return }
    // แปลงจุดจาก display -> image coords
    const ip = points.map((p) => ({ x: p.x / scale, y: p.y / scale }))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of ip) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
    minX = Math.max(0, Math.floor(minX)); minY = Math.max(0, Math.floor(minY))
    maxX = Math.min(img.width, Math.ceil(maxX)); maxY = Math.min(img.height, Math.ceil(maxY))
    const w = maxX - minX, h = maxY - minY
    if (w < 4 || h < 4) { setPoints([]); redraw([]); return }

    const c = createCanvas(w, h)
    const ctx = ctx2d(c)
    ctx.beginPath()
    ctx.moveTo(ip[0].x - minX, ip[0].y - minY)
    for (let i = 1; i < ip.length; i++) ctx.lineTo(ip[i].x - minX, ip[i].y - minY)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(img, -minX, -minY)

    setCrops((prev) => [...prev, { canvas: c, from: activeIdx, rect: { x: minX, y: minY, w, h } }])
    setPoints([]); redraw([])
  }

  function removeCrop(i: number) {
    setCrops((prev) => prev.filter((_, idx) => idx !== i))
  }

  function done() {
    // auto die-cut ทันทีด้วย chroma (เร็ว) — ปรับเป็น AI/ตามที่ครอปได้ในหน้าแก้ไข
    // เก็บภาพต้นฉบับ (ทั้งชีต) + กรอบ ไว้ปรับกรอบใหม่ได้ กันหัวขาด
    if (crops.length) {
      addSources(
        crops.map((c) => ({ source: c.canvas, origin: { image: images[c.from], rect: c.rect } })),
        'chroma',
      )
    }
    clearCropQueue()
    setScreen('manage')
  }

  if (!img) {
    return (
      <div className="panel">
        <h2>ไม่มีรูปสำหรับครอป</h2>
        <button className="btn-primary" onClick={() => { clearCropQueue(); setScreen('manage') }}>← กลับหน้าจัดการ</button>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>✂️ ครอปแบบ free-form (lasso)</h2>
        <div className="row">
          <button className="btn-ghost" onClick={() => { clearCropQueue(); setScreen('manage') }}>ยกเลิก</button>
          <button className="btn-primary" onClick={done} disabled={crops.length === 0}>
            เพิ่ม {crops.length} ตัวเข้าชุด →
          </button>
        </div>
      </div>
      <div className="sub">ลากเมาส์วาดกรอบรอบสติกเกอร์แต่ละตัว ปล่อยเมาส์เพื่อครอป — ทำซ้ำได้หลายตัว</div>

      {images.length > 1 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="help">รูปที่:</span>
          {images.map((_, i) => (
            <button key={i} className={i === activeIdx ? 'toolbtn active' : 'toolbtn'}
              onClick={() => setActiveIdx(i)} style={{ padding: '4px 12px' }}>{i + 1}</button>
          ))}
        </div>
      )}

      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="checker" style={{ display: 'inline-block', lineHeight: 0, borderRadius: 8, border: '1px solid var(--line)' }}>
          <canvas ref={canvasRef}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
            style={{ cursor: 'crosshair', touchAction: 'none', maxWidth: '100%', height: 'auto', display: 'block' }} />
        </div>

        <div style={{ minWidth: 220, flex: 1 }}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>ขอบขาวเริ่มต้น: {defaultBorder === 0 ? 'ไม่มีขอบ' : `${defaultBorder}px`}</label>
            <input type="range" min={0} max={20} value={defaultBorder}
              onChange={(e) => setDefaultBorder(+e.target.value)} />
            <span className="help">ปรับต่อตัวได้อีกในหน้าแก้ไข</span>
          </div>

          <hr className="hr" />
          <div className="help" style={{ marginBottom: 8 }}>ครอปที่ทำแล้ว ({crops.length})</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(70px,1fr))', gap: 8 }}>
            {crops.map((c, i) => (
              <div key={i} className="card" style={{ position: 'relative' }}>
                <div className="thumb checker" style={{ aspectRatio: '1' }}>
                  <CropThumb canvas={c.canvas} />
                </div>
                <button className="btn-danger" style={{ position: 'absolute', top: 2, right: 2, padding: '0 6px', fontSize: 12 }}
                  onClick={() => removeCrop(i)}>✕</button>
              </div>
            ))}
          </div>
          {crops.length === 0 && <div className="help">ยังไม่มี — ลากวาดกรอบบนรูป</div>}
        </div>
      </div>
    </div>
  )
}

function CropThumb({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.width = canvas.width; el.height = canvas.height
    ctx2d(el).drawImage(canvas, 0, 0)
  }, [canvas])
  return <canvas ref={ref} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
}
