import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApngFrame, Rect } from '../types'
import { useStore } from '../store'
import { toEven } from '../constants'
import { encodeApng } from '../lib/apng'
import { downloadBlob } from '../lib/zip'
import { NumberField } from './NumberField'

const MIN_FRAMES = 4
const MAX_FRAMES = 20
const MAX_APNG_BYTES = 300 * 1024
/** ระยะเว้นขอบตอนจัดวางอัตโนมัติ */
const AUTO_MARGIN = 10

type Transform = { k: number; ox: number; oy: number }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** โหลดรูป + หา bbox ของเนื้อหา (alpha) สำหรับจัดวางอัตโนมัติ */
async function loadFrameImage(file: File): Promise<{ image: ImageBitmap; name: string; bbox: Rect }> {
  const image = await createImageBitmap(file)
  const c = document.createElement('canvas')
  c.width = image.width
  c.height = image.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(image, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const bbox: Rect = maxX < 0
    ? { x: 0, y: 0, w: image.width, h: image.height }
    : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  return { image, name: file.name, bbox }
}

/** รูปย่อในกล่องเฟรม */
function BitmapThumb({ image, size = 78 }: { image: ImageBitmap; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const s = Math.min(size / image.width, size / image.height)
    c.width = Math.max(1, Math.round(image.width * s))
    c.height = Math.max(1, Math.round(image.height * s))
    c.getContext('2d')!.drawImage(image, 0, 0, c.width, c.height)
  }, [image, size])
  return <canvas ref={ref} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
}

export function ApngScreen() {
  const frames = useStore((s) => s.apngFrames)
  const W = useStore((s) => s.apngW)
  const H = useStore((s) => s.apngH)
  const delay = useStore((s) => s.apngDelay)
  const loops = useStore((s) => s.apngLoops)
  const { apngAddSlot, apngRemoveSlot, apngFillImages, apngSetManual, apngSetSize, apngSetDelay, apngSetLoops } = useStore()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(true)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const pickTarget = useRef<string | null>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<HTMLCanvasElement>(null)

  const filled = useMemo(() => frames.filter((f): f is ApngFrame & { image: ImageBitmap; bbox: Rect } => !!f.image && !!f.bbox), [frames])
  const selected = filled.find((f) => f.id === selectedId) ?? null

  // ---- จัดวางอัตโนมัติ: ยึด bbox ของภาพแรกเป็นหลัก ให้ subject ทุกเฟรมขนาด/ตำแหน่งตรงกัน ----
  const autoT = useMemo(() => {
    const map = new Map<string, Transform>()
    if (!filled.length) return map
    const ref = filled[0].bbox
    const availW = W - AUTO_MARGIN * 2
    const availH = H - AUTO_MARGIN * 2
    const S = Math.min(availW / ref.w, availH / ref.h)
    const cx = W / 2, cy = H / 2
    for (const f of filled) {
      const b = f.bbox
      // สเกลให้ subject เท่ากับภาพแรก (เทียบขนาด bbox)
      const k = S * Math.min(ref.w / b.w, ref.h / b.h)
      map.set(f.id, {
        k,
        ox: cx - (b.x + b.w / 2) * k,
        oy: cy - (b.y + b.h / 2) * k,
      })
    }
    return map
  }, [filled, W, H])

  const effT = (f: ApngFrame): Transform =>
    f.manual ?? autoT.get(f.id) ?? { k: 1, ox: 0, oy: 0 }

  // เรนเดอร์เฟรมตาม transform
  const frameCanvases = useMemo(() => {
    return filled.map((f) => {
      const c = document.createElement('canvas')
      c.width = toEven(W)
      c.height = toEven(H)
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      const t = effT(f)
      ctx.drawImage(f.image, t.ox, t.oy, f.image.width * t.k, f.image.height * t.k)
      return c
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filled, autoT, W, H, frames])

  // ---- เครื่องเล่นพรีวิว ----
  useEffect(() => {
    const cv = previewRef.current
    if (!cv || !frameCanvases.length) return
    cv.width = toEven(W)
    cv.height = toEven(H)
    const ctx = cv.getContext('2d')!
    let i = 0
    const draw = () => { ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(frameCanvases[i], 0, 0) }
    draw()
    if (!playing || frameCanvases.length < 2) return
    const t = window.setInterval(() => { i = (i + 1) % frameCanvases.length; draw() }, Math.max(20, delay))
    return () => window.clearInterval(t)
  }, [frameCanvases, delay, playing, W, H])

  // ---- ตัวปรับ manual (ghost ภาพแรก + ลาก/ล้อเมาส์/สองนิ้ว) ----
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d0: number; k0: number; cx: number; cy: number; ox0: number; oy0: number } | null>(null)
  const dragging = useRef<{ sx: number; sy: number; t0: Transform } | null>(null)

  const drawEditor = () => {
    const cv = editorRef.current
    if (!cv || !selected) return
    cv.width = toEven(W)
    cv.height = toEven(H)
    const ctx = cv.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    // ghost ภาพแรก (ถ้าตัวที่เลือกไม่ใช่ภาพแรก)
    if (filled[0] && filled[0].id !== selected.id) {
      const g = effT(filled[0])
      ctx.globalAlpha = 0.35
      ctx.drawImage(filled[0].image, g.ox, g.oy, filled[0].image.width * g.k, filled[0].image.height * g.k)
      ctx.globalAlpha = 1
    }
    const t = effT(selected)
    ctx.drawImage(selected.image, t.ox, t.oy, selected.image.width * t.k, selected.image.height * t.k)
    // กรอบ + เขตเว้นขอบ
    ctx.strokeStyle = 'rgba(20,120,255,0.9)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, cv.width - 2, cv.height - 2)
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = 'rgba(230,30,30,0.9)'
    ctx.strokeRect(AUTO_MARGIN, AUTO_MARGIN, cv.width - AUTO_MARGIN * 2, cv.height - AUTO_MARGIN * 2)
    ctx.setLineDash([])
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(drawEditor, [selected, frames, autoT, W, H])

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const cv = editorRef.current!
    const r = cv.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }
  }

  function zoomSelected(factor: number, cx?: number, cy?: number) {
    if (!selected) return
    const t = effT(selected)
    const px = cx ?? toEven(W) / 2
    const py = cy ?? toEven(H) / 2
    const nk = clamp(t.k * factor, 0.02, 50)
    const r = nk / t.k
    apngSetManual(selected.id, { k: nk, ox: px - (px - t.ox) * r, oy: py - (py - t.oy) * r })
  }

  function onDown(e: React.PointerEvent) {
    if (!selected) return
    const p = toCanvas(e)
    pointers.current.set(e.pointerId, p)
    try { editorRef.current!.setPointerCapture(e.pointerId) } catch { /* synthetic */ }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const t = effT(selected)
      pinch.current = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: t.k,
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ox0: t.ox, oy0: t.oy,
      }
      dragging.current = null
      return
    }
    dragging.current = { sx: p.x, sy: p.y, t0: effT(selected) }
  }
  function onMove(e: React.PointerEvent) {
    if (!selected) return
    const p = toCanvas(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p)
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const pc = pinch.current
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const nk = clamp(pc.k0 * (d / pc.d0), 0.02, 50)
      const r = nk / pc.k0
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
      apngSetManual(selected.id, { k: nk, ox: cx - (pc.cx - pc.ox0) * r, oy: cy - (pc.cy - pc.oy0) * r })
      return
    }
    if (dragging.current) {
      const d = dragging.current
      apngSetManual(selected.id, { ...d.t0, ox: d.t0.ox + (p.x - d.sx), oy: d.t0.oy + (p.y - d.sy) })
    }
  }
  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pinch.current && pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) dragging.current = null
  }

  // wheel zoom (native เพื่อ preventDefault)
  useEffect(() => {
    const cv = editorRef.current
    if (!cv) return
    const h = (e: WheelEvent) => {
      e.preventDefault()
      const p = toCanvas(e)
      zoomSelected(Math.exp(-e.deltaY * 0.0015), p.x, p.y)
    }
    cv.addEventListener('wheel', h, { passive: false })
    return () => cv.removeEventListener('wheel', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, frames])

  // ---- อัปโหลดรูปเข้า “กล่องเฟรม” ----
  function openPicker(slotId: string) {
    pickTarget.current = slotId
    fileRef.current?.click()
  }
  async function onFiles(list: FileList | null) {
    if (!list?.length || !pickTarget.current) return
    setBusy(true)
    try {
      const items = []
      for (const f of Array.from(list)) {
        if (!f.type.startsWith('image/')) continue
        try { items.push(await loadFrameImage(f)) } catch { /* ข้ามไฟล์เสีย */ }
      }
      if (items.length) apngFillImages(pickTarget.current, items)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function downloadApng() {
    setBusy(true)
    try {
      const blob = await encodeApng(frameCanvases, delay, loops)
      if (blob.size > MAX_APNG_BYTES) {
        alert(`⚠️ ไฟล์ ${(blob.size / 1024).toFixed(0)}KB เกิน 300KB (ลิมิตของ LINE) — ลองลดขนาด/จำนวนเฟรม`)
      }
      downloadBlob(blob, 'animation.png')
    } catch (e) {
      alert('สร้าง APNG ไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const totalMs = filled.length * delay
  const canExport = filled.length >= MIN_FRAMES

  return (
    <>
      <div className="panel">
        <h2>🎞️ เครื่องมือทำภาพเคลื่อนไหว APNG</h2>
        <div className="sub">
          อิสระจากชุดสติกเกอร์ — เพิ่มรูปทีละกล่องเฟรม (ขั้นต่ำ {MIN_FRAMES}, สูงสุด {MAX_FRAMES}) ·
          ระบบจัดตำแหน่ง/ขนาดให้ตรงกับ<b>ภาพแรก</b>อัตโนมัติเพื่อให้แอนิเมชันลื่นไหล และปรับเองได้
        </div>

        {/* กล่องเฟรม */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label>เฟรม ({filled.length}/{frames.length} กล่อง) — แตะกล่องว่างเพื่อเลือกรูป · แตะรูปเพื่อปรับตำแหน่ง</label>
          <div className="row" style={{ gap: 8 }}>
            {frames.map((f, i) => (
              <div key={f.id}
                onClick={() => (f.image ? setSelectedId(f.id) : openPicker(f.id))}
                className={f.image ? 'checker' : ''}
                style={{
                  position: 'relative', width: 84, height: 84, borderRadius: 8, cursor: 'pointer',
                  border: selectedId === f.id && f.image ? '2px solid var(--pink)' : '1px solid var(--line)',
                  display: 'grid', placeItems: 'center',
                  background: f.image ? undefined : '#fafafa',
                }}>
                {f.image
                  ? <BitmapThumb image={f.image} />
                  : <span className="help" style={{ textAlign: 'center' }}>＋<br />เลือกรูป</span>}
                <span style={{ position: 'absolute', top: -7, left: -7, background: f.image ? 'var(--pink)' : '#bbb', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, width: 17, height: 17, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
                {f.manual && <span title="ปรับเองแล้ว" style={{ position: 'absolute', bottom: 2, right: 4, fontSize: 11 }}>✋</span>}
                <button className="btn-danger" title="ลบกล่อง/ล้างรูป"
                  onClick={(e) => { e.stopPropagation(); apngRemoveSlot(f.id); if (selectedId === f.id) setSelectedId(null) }}
                  style={{ position: 'absolute', top: -8, right: -8, padding: 0, width: 20, height: 20, minHeight: 0, borderRadius: 999, fontSize: 11, lineHeight: 1 }}>✕</button>
              </div>
            ))}
            {frames.length < MAX_FRAMES && (
              <div onClick={apngAddSlot}
                style={{ width: 84, height: 84, borderRadius: 8, border: '2px dashed var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--muted)', fontSize: 26 }}>
                ＋
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
            onChange={(e) => onFiles(e.target.files)} />
        </div>

        {/* ตั้งค่า */}
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label>ขนาด (สูงสุด 320×270)</label>
            <div className="row" style={{ gap: 4 }}>
              <button className={W === 320 && H === 270 ? 'toolbtn active' : 'toolbtn'} style={{ padding: '6px 8px' }} onClick={() => apngSetSize(320, 270)}>สติกเกอร์ 320×270</button>
              <button className={W === 240 && H === 240 ? 'toolbtn active' : 'toolbtn'} style={{ padding: '6px 8px' }} onClick={() => apngSetSize(240, 240)}>หลัก 240</button>
              <button className={W === 180 && H === 180 ? 'toolbtn active' : 'toolbtn'} style={{ padding: '6px 8px' }} onClick={() => apngSetSize(180, 180)}>อิโมจิ 180</button>
            </div>
          </div>
          <div className="field"><label>กว้าง</label>
            <NumberField value={W} min={2} max={320} normalize={toEven} onCommit={(v) => apngSetSize(v, H)} width={70} /></div>
          <div className="field"><label>สูง</label>
            <NumberField value={H} min={2} max={270} normalize={toEven} onCommit={(v) => apngSetSize(W, v)} width={70} /></div>
          <div className="field"><label>หน่วง/เฟรม (ms)</label>
            <NumberField value={delay} min={20} max={4000} onCommit={apngSetDelay} width={70} /></div>
          <div className="field"><label>รอบเล่น</label>
            <select value={loops} onChange={(e) => apngSetLoops(+e.target.value)}>
              <option value={1}>1</option><option value={2}>2</option>
              <option value={3}>3</option><option value={4}>4</option>
            </select></div>
          <div className="help" style={{ alignSelf: 'center' }}>
            {filled.length} เฟรม × {delay}ms = <b>{(totalMs / 1000).toFixed(2)}s</b>
            {totalMs > 4000 && <span style={{ color: 'var(--err)' }}> ⚠️ เกิน 4s</span>}
          </div>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
        {/* ปรับตำแหน่งเฟรมที่เลือก */}
        <div className="panel" style={{ flex: '1 1 300px', marginBottom: 20 }}>
          <h2>🎯 จัดตำแหน่งเฟรม {selected ? `#${filled.indexOf(selected) + 1}` : ''}</h2>
          <div className="sub">
            {selected
              ? selected.id === filled[0]?.id
                ? 'นี่คือภาพแรก (ภาพอ้างอิง) — เฟรมอื่นจะถูกจัดให้ตรงกับภาพนี้'
                : 'ลาก = เลื่อน · ล้อเมาส์/2 นิ้ว = ซูม · โครงจางๆ = ภาพแรก จัดให้ทับกันแล้วภาพจะลื่น'
              : 'แตะรูปในกล่องเฟรมด้านบนเพื่อปรับตำแหน่ง'}
          </div>
          {selected ? (
            <>
              <div className="checker" style={{ borderRadius: 8, border: '1px solid var(--line)', width: '100%', maxWidth: 340, aspectRatio: `${W} / ${H}` }}>
                <canvas ref={editorRef}
                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
                  style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'move', display: 'block' }} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn-ghost" onClick={() => zoomSelected(1 / 1.1)}>➖</button>
                <button className="btn-ghost" onClick={() => zoomSelected(1.1)}>➕</button>
                <button className="btn-ghost" onClick={() => selected && apngSetManual(selected.id, null)}
                  disabled={!selected?.manual}>↺ อัตโนมัติ</button>
                <span className="help" style={{ alignSelf: 'center' }}>
                  {selected.manual ? '✋ ปรับเอง' : '🤖 อัตโนมัติ (ยึดภาพแรก)'}
                </span>
              </div>
            </>
          ) : (
            <div className="help" style={{ padding: 24, textAlign: 'center' }}>ยังไม่ได้เลือกเฟรม</div>
          )}
        </div>

        {/* พรีวิว + ดาวน์โหลด */}
        <div className="panel" style={{ flex: '1 1 300px', marginBottom: 20 }}>
          <h2>▶︎ พรีวิว & ส่งออก</h2>
          <div className="sub">ไฟล์ .png (APNG) · โปร่งใส · ≤300KB · เล่น {loops} รอบ</div>
          <div className="checker" style={{ borderRadius: 8, border: '1px solid var(--line)', width: '100%', maxWidth: 340, aspectRatio: `${W} / ${H}`, display: 'grid', placeItems: 'center' }}>
            {filled.length
              ? <canvas ref={previewRef} style={{ width: '100%', height: '100%', display: 'block' }} />
              : <span className="help">เพิ่มรูปในกล่องเฟรมก่อน</span>}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn-ghost" onClick={() => setPlaying(!playing)} disabled={filled.length < 2}>
              {playing ? '⏸ หยุด' : '▶︎ เล่น'}
            </button>
            <button className="btn-primary" onClick={downloadApng} disabled={busy || !canExport}>
              {busy ? 'กำลังสร้าง…' : '⬇️ ดาวน์โหลด APNG'}
            </button>
          </div>
          {!canExport && (
            <div className="help" style={{ marginTop: 6, color: 'var(--warn)' }}>
              ต้องมีอย่างน้อย {MIN_FRAMES} เฟรม (ตอนนี้ {filled.length})
            </div>
          )}
        </div>
      </div>
    </>
  )
}
