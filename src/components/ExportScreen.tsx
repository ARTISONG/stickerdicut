import { useState } from 'react'
import { useStore } from '../store'
import { SPEC } from '../constants'
import { buildZip, downloadBlob, type ZipBuildResult } from '../lib/zip'
import { StickerThumb } from './StickerThumb'

export function ExportScreen() {
  const meta = useStore((s) => s.meta)
  const stickers = useStore((s) => s.stickers)
  const stickerW = useStore((s) => s.stickerW)
  const stickerH = useStore((s) => s.stickerH)
  const frameMargin = useStore((s) => s.frameMargin)
  const mainW = useStore((s) => s.mainW)
  const mainH = useStore((s) => s.mainH)
  const tabW = useStore((s) => s.tabW)
  const tabH = useStore((s) => s.tabH)
  const { setMain, setTab, setScreen } = useStore()

  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ZipBuildResult | null>(null)

  const ready = stickers.filter((s) => s.mask && !s.processing)
  const notReady = stickers.filter((s) => !s.mask || s.processing)

  async function build() {
    setBuilding(true)
    setResult(null)
    setProgress(0)
    try {
      const res = await buildZip(
        ready, meta,
        { stickerW, stickerH, mainW, mainH, tabW, tabH, margin: frameMargin },
        (done, total) => setProgress(Math.round((done / total) * 100)),
      )
      setResult(res)
    } catch (e) {
      console.error(e)
      alert('สร้าง ZIP ไม่สำเร็จ: ' + (e as Error).message)
    } finally {
      setBuilding(false)
    }
  }

  const mb = (b: number) => (b / 1024 / 1024).toFixed(2) + ' MB'
  const kb = (b: number) => (b / 1024).toFixed(0) + ' KB'

  return (
    <>
      <div className="panel">
        <h2>เลือกรูปหลัก & แท็บ</h2>
        <div className="sub">รูปหลัก (main) ส่งออก {mainW}×{mainH} · แท็บห้องแชท (tab) ส่งออก {tabW}×{tabH} — ปรับขนาดได้ที่หน้าจัดการ</div>
        <div className="row">
          <div className="field">
            <label>รูปหลัก ({mainW}×{mainH})</label>
            <select value={meta.mainStickerId ?? ''} onChange={(e) => setMain(e.target.value)}>
              {stickers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>รูปแท็บ ({tabW}×{tabH})</label>
            <select value={meta.tabStickerId ?? ''} onChange={(e) => setTab(e.target.value)}>
              {stickers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          {meta.mainStickerId && (() => {
            const s = stickers.find((x) => x.id === meta.mainStickerId)
            return s ? <div style={{ textAlign: 'center' }}><div className="help">main {mainW}×{mainH}</div><div className="checker" style={{ width: 120, height: 120 * (mainH / mainW), display: 'grid', placeItems: 'center', borderRadius: 8 }}><StickerThumb sticker={s} width={mainW} height={mainH} margin={frameMargin} /></div></div> : null
          })()}
          {meta.tabStickerId && (() => {
            const s = stickers.find((x) => x.id === meta.tabStickerId)
            return s ? <div style={{ textAlign: 'center' }}><div className="help">tab {tabW}×{tabH}</div><div className="checker" style={{ width: 120, height: 120 * (tabH / tabW), display: 'grid', placeItems: 'center', borderRadius: 8 }}><StickerThumb sticker={s} width={tabW} height={tabH} margin={frameMargin} /></div></div> : null
          })()}
        </div>
      </div>

      <div className="panel">
        <h2>ตรวจสเปก & ดาวน์โหลด</h2>
        <div className="sub">
          สติกเกอร์ {stickerW}×{stickerH}px · PNG RGBA · 72 dpi · โปร่งใส · แต่ละไฟล์ ≤ 1MB · ZIP ≤ 60MB
        </div>

        {notReady.length > 0 && (
          <div style={{ background: '#fef3c7', color: '#92400e', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            ⚠️ มี {notReady.length} ตัวที่ยังตัดพื้นหลังไม่เสร็จ/ไม่มีเนื้อภาพ จะไม่ถูกใส่ใน ZIP
          </div>
        )}
        <div className="row">
          <button className="btn-primary" onClick={build} disabled={building || ready.length === 0}>
            {building ? `กำลังสร้าง… ${progress}%` : `📦 สร้าง ZIP (${ready.length} ตัว + main + tab)`}
          </button>
          {result && (
            <button className="btn-ghost" onClick={() => downloadBlob(result.blob, `${meta.name || 'stickers'}.zip`)}>
              ⬇️ ดาวน์โหลด {meta.name || 'stickers'}.zip ({mb(result.totalBytes)})
            </button>
          )}
        </div>

        {result && (
          <>
            <hr className="hr" />
            {result.overLimit && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
                ❌ ZIP รวม {mb(result.totalBytes)} เกิน 60MB
              </div>
            )}
            <table className="spec">
              <thead><tr><th>ไฟล์</th><th>ขนาดไฟล์</th><th>สถานะ</th></tr></thead>
              <tbody>
                {result.files.map((f) => {
                  const over = f.bytes > SPEC.MAX_FILE_BYTES
                  return (
                    <tr key={f.name}>
                      <td>{f.name}</td>
                      <td>{kb(f.bytes)}</td>
                      <td>{over
                        ? <span className="badge warn">เกิน 1MB</span>
                        : <span className="badge ok">ผ่าน</span>}</td>
                    </tr>
                  )
                })}
                <tr>
                  <td><b>รวม ZIP</b></td>
                  <td><b>{mb(result.totalBytes)}</b></td>
                  <td>{result.overLimit ? <span className="badge warn">เกิน 60MB</span> : <span className="badge ok">ผ่าน</span>}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {ready.length === 0 && (
          <div className="help" style={{ marginTop: 12 }}>
            ยังไม่มีสติกเกอร์ที่พร้อม — <button className="btn-ghost" onClick={() => setScreen('manage')}>ไปหน้าจัดการเพื่ออัปโหลด</button>
          </div>
        )}
      </div>
    </>
  )
}
