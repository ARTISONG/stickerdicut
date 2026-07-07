import { useEffect, useRef, useState } from 'react'
import type { SourceItem } from '../store'
import { useStore } from '../store'
import { fileToImageBitmap, cropCanvas } from '../lib/canvas'
import { findBlobs } from '../lib/segment'
import { chromaKeyMask } from '../lib/chroma'
import { DEFAULT_CHROMA_TOLERANCE } from '../constants'

type Mode = 'single' | 'grid' | 'auto' | 'crop'

/** พรีวิวรูปที่อัปโหลด (ย่อให้พอดี) */
function PreviewThumb({ bmp }: { bmp: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const max = 96
    const s = Math.min(max / bmp.width, max / bmp.height, 1)
    c.width = Math.round(bmp.width * s)
    c.height = Math.round(bmp.height * s)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  }, [bmp])
  return <canvas ref={ref} style={{ display: 'block', maxWidth: 96, maxHeight: 96 }} />
}

export function UploadZone() {
  const addSources = useStore((s) => s.addSources)
  const startCrop = useStore((s) => s.startCrop)
  const [drag, setDrag] = useState(false)
  const [pending, setPending] = useState<ImageBitmap[]>([])
  const [mode, setMode] = useState<Mode>('single')
  const [cols, setCols] = useState(4)
  const [rows, setRows] = useState(4)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return
    const bmps: ImageBitmap[] = []
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue
      try {
        bmps.push(await fileToImageBitmap(f))
      } catch (e) {
        console.error('โหลดรูปไม่ได้', f.name, e)
      }
    }
    if (bmps.length) setPending(bmps)
  }

  async function confirm() {
    if (mode === 'crop') {
      // ส่งรูปทั้งหมดไปหน้าครอป free-form
      startCrop(pending)
      setPending([])
      setMode('single')
      return
    }
    setBusy(true)
    try {
      const out: SourceItem[] = []
      const BLOB_MARGIN = 8
      for (const bmp of pending) {
        if (mode === 'single') {
          out.push({ source: bmp, origin: { image: bmp, rect: { x: 0, y: 0, w: bmp.width, h: bmp.height } } })
        } else if (mode === 'grid') {
          const cellW = Math.floor(bmp.width / cols)
          const cellH = Math.floor(bmp.height / rows)
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const rect = { x: c * cellW, y: r * cellH, w: cellW, h: cellH }
              out.push({ source: cropCanvas(bmp, rect.x, rect.y, rect.w, rect.h), origin: { image: bmp, rect } })
            }
          }
        } else {
          // auto-blob: หา blob จาก chroma mask ของทั้งชีต
          const { mask, width, height } = chromaKeyMask(bmp, DEFAULT_CHROMA_TOLERANCE)
          const blobs = findBlobs(mask, width, height)
          if (blobs.length > 1) {
            for (const b of blobs) {
              const x = Math.max(0, b.x - BLOB_MARGIN)
              const y = Math.max(0, b.y - BLOB_MARGIN)
              const w = Math.min(bmp.width - x, b.w + BLOB_MARGIN * 2)
              const h = Math.min(bmp.height - y, b.h + BLOB_MARGIN * 2)
              const rect = { x, y, w, h }
              out.push({ source: cropCanvas(bmp, x, y, w, h), origin: { image: bmp, rect } })
            }
          } else {
            out.push({ source: bmp, origin: { image: bmp, rect: { x: 0, y: 0, w: bmp.width, h: bmp.height } } })
          }
        }
      }
      // วิธีเริ่มต้น = chroma (เร็ว/ทันที) ไม่รัน AI อัตโนมัติเพื่อไม่ให้ค้าง
      addSources(out, 'chroma')
      setPending([])
      setMode('single')
    } finally {
      setBusy(false)
    }
  }

  if (pending.length > 0) {
    return (
      <div className="panel">
        <h2>เลือกวิธีจัดการรูปที่อัปโหลด ({pending.length} ไฟล์)</h2>
        <div className="sub">รูปเป็นชีตรวมหลายตัว หรือไฟล์เดี่ยว 1 ตัว?</div>
        {/* พรีวิวรูปที่อัปโหลด */}
        <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          {pending.map((bmp, i) => (
            <div key={i} className="checker" style={{ borderRadius: 8, border: '1px solid var(--line)', padding: 2, lineHeight: 0 }}>
              <PreviewThumb bmp={bmp} />
            </div>
          ))}
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <button className={mode === 'single' ? 'toolbtn active' : 'toolbtn'} onClick={() => setMode('single')}>
            🖼️ ไฟล์เดี่ยว (1 ไฟล์ = 1 สติกเกอร์)
          </button>
          <button className={mode === 'grid' ? 'toolbtn active' : 'toolbtn'} onClick={() => setMode('grid')}>
            ▦ แยกแบบตาราง
          </button>
          <button className={mode === 'auto' ? 'toolbtn active' : 'toolbtn'} onClick={() => setMode('auto')}>
            ✨ แยกอัตโนมัติ
          </button>
          <button className={mode === 'crop' ? 'toolbtn active' : 'toolbtn'} onClick={() => setMode('crop')}>
            ✂️ ครอปเอง (free-form)
          </button>
        </div>

        {mode === 'grid' && (
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>คอลัมน์ (แนวนอน)</label>
              <input type="number" min={1} max={12} value={cols}
                onChange={(e) => setCols(Math.max(1, +e.target.value))} style={{ width: 90 }} />
            </div>
            <div className="field">
              <label>แถว (แนวตั้ง)</label>
              <input type="number" min={1} max={12} value={rows}
                onChange={(e) => setRows(Math.max(1, +e.target.value))} style={{ width: 90 }} />
            </div>
            <div className="help" style={{ alignSelf: 'end' }}>
              จะได้ {cols * rows} ตัว/ชีต
            </div>
          </div>
        )}
        {mode === 'auto' && (
          <div className="help" style={{ marginBottom: 14 }}>
            ตรวจจับก้อนสติกเกอร์จากสีพื้นหลังอัตโนมัติ — เหมาะกับชีตที่พื้นหลังเป็นสีเดียวชัดเจน
            (ไม่รัน AI อัตโนมัติ กด “ตัดด้วย AI” ทีหลังได้)
          </div>
        )}
        {mode === 'crop' && (
          <div className="help" style={{ marginBottom: 14 }}>
            ✂️ ลากวาดกรอบรอบสติกเกอร์แต่ละตัวเองแบบอิสระ (lasso) แล้วค่อยตัดพื้นหลังต่อ —
            เร็วและควบคุมได้ ไม่ค้างเหมือนโหมดอัตโนมัติ
          </div>
        )}

        <div className="row">
          <button className="btn-primary" onClick={confirm} disabled={busy}>
            {busy ? 'กำลังประมวลผล…' : mode === 'crop' ? '✂️ ไปหน้าครอป' : 'เพิ่มเข้าชุด'}
          </button>
          <button className="btn-ghost" onClick={() => setPending([])} disabled={busy}>
            ยกเลิก
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={drag ? 'dropzone drag' : 'dropzone'}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
      onClick={() => inputRef.current?.click()}
      style={{ cursor: 'pointer' }}
    >
      <input ref={inputRef} type="file" accept="image/png,image/jpeg" multiple hidden
        onChange={(e) => handleFiles(e.target.files)} />
      <div style={{ fontSize: 40, marginBottom: 8 }}>📥</div>
      <div><strong>ลากรูปมาวาง</strong> หรือคลิกเพื่อเลือกไฟล์</div>
      <div className="help" style={{ marginTop: 6 }}>รองรับ PNG / JPG — ทั้งชีตรวมและไฟล์เดี่ยว</div>
    </div>
  )
}
