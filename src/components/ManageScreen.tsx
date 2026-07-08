import { useState } from 'react'
import { useStore } from '../store'
import { SIZE_PRESETS, toEven } from '../constants'
import { UploadZone } from './UploadZone'
import { StickerThumb } from './StickerThumb'

export function ManageScreen() {
  const meta = useStore((s) => s.meta)
  const stickers = useStore((s) => s.stickers)
  const stickerW = useStore((s) => s.stickerW)
  const stickerH = useStore((s) => s.stickerH)
  const defaultBorder = useStore((s) => s.defaultBorder)
  const frameMargin = useStore((s) => s.frameMargin)
  const mainW = useStore((s) => s.mainW)
  const mainH = useStore((s) => s.mainH)
  const tabW = useStore((s) => s.tabW)
  const tabH = useStore((s) => s.tabH)
  const aiBatch = useStore((s) => s.aiBatch)
  const { setStickerSize, setDefaultBorder, setFrameMargin, setMainSize, setTabSize, removeSticker, openEditor, aiCutAll } = useStore()

  const matchPreset = SIZE_PRESETS.find((p) => p.width === stickerW && p.height === stickerH)
  const [presetId, setPresetId] = useState(matchPreset ? matchPreset.id : 'custom')

  function onPreset(id: string) {
    setPresetId(id)
    const p = SIZE_PRESETS.find((x) => x.id === id)
    if (p) setStickerSize(p.width, p.height)
  }

  return (
    <>
      <div className="panel">
        <h2>ขนาดสติกเกอร์ (export)</h2>
        <div className="sub">เลือกขนาด ขอบขาว และระยะเว้นขอบ — ทุกรูปจะถูก export ตามนี้</div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label>ขนาด</label>
            <select value={presetId} onChange={(e) => onPreset(e.target.value)}>
              {SIZE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
              <option value="custom">กำหนดเอง…</option>
            </select>
          </div>
          {presetId === 'custom' && (
            <>
              <div className="field">
                <label>กว้าง (px)</label>
                <input type="number" min={2} step={2} value={stickerW}
                  onChange={(e) => setStickerSize(toEven(+e.target.value), stickerH)} style={{ width: 100 }} />
              </div>
              <div className="field">
                <label>สูง (px)</label>
                <input type="number" min={2} step={2} value={stickerH}
                  onChange={(e) => setStickerSize(stickerW, toEven(+e.target.value))} style={{ width: 100 }} />
              </div>
            </>
          )}
          <div className="field">
            <label>ขอบขาวเริ่มต้น: {defaultBorder === 0 ? 'ไม่มีขอบ' : `${defaultBorder}px`}</label>
            <input type="range" min={0} max={20} value={defaultBorder} style={{ width: 140 }}
              onChange={(e) => setDefaultBorder(+e.target.value)} />
          </div>
          <div className="field">
            <label>เว้นขอบในเฟรม: {frameMargin}px</label>
            <input type="range" min={0} max={40} value={frameMargin} style={{ width: 140 }}
              onChange={(e) => setFrameMargin(+e.target.value)} />
          </div>
          <div className="help" style={{ alignSelf: 'center' }}>
            ผลลัพธ์ต่อตัว: <b>{stickerW} × {stickerH}</b> px (เลขคู่อัตโนมัติ) ·
            เว้นขอบ ~{frameMargin}px เพื่อความสมดุล
          </div>
        </div>

        {presetId === 'custom' && (
          <>
            <hr className="hr" />
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field"><label>รูปหลัก (main) กว้าง</label>
                <input type="number" min={2} step={2} value={mainW}
                  onChange={(e) => setMainSize(toEven(+e.target.value), mainH)} style={{ width: 90 }} /></div>
              <div className="field"><label>สูง</label>
                <input type="number" min={2} step={2} value={mainH}
                  onChange={(e) => setMainSize(mainW, toEven(+e.target.value))} style={{ width: 90 }} /></div>
              <div className="field" style={{ marginLeft: 12 }}><label>รูปแท็บ (tab) กว้าง</label>
                <input type="number" min={2} step={2} value={tabW}
                  onChange={(e) => setTabSize(toEven(+e.target.value), tabH)} style={{ width: 90 }} /></div>
              <div className="field"><label>สูง</label>
                <input type="number" min={2} step={2} value={tabH}
                  onChange={(e) => setTabSize(tabW, toEven(+e.target.value))} style={{ width: 90 }} /></div>
              <div className="help" style={{ alignSelf: 'center' }}>ค่าเริ่มต้น: main 240×240 · tab 96×74</div>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <h2>อัปโหลดรูป</h2>
        <div className="sub">เพิ่มรูปเข้าชุด แล้วระบบจะตัดพื้นหลัง (die-cut) และใส่ขอบขาว 2px ให้อัตโนมัติ</div>
        <UploadZone />
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>สติกเกอร์ในชุด ({stickers.length})</h2>
          <button className="btn-ghost" onClick={aiCutAll}
            disabled={!!aiBatch || stickers.length === 0}>
            {aiBatch ? `🤖 กำลังตัด AI… ${aiBatch.done}/${aiBatch.total}` : '🤖 ตัดด้วย AI ทั้งชุด'}
          </button>
        </div>
        <div className="sub">
          เริ่มต้นตัดแบบเร็ว (chroma) — คลิกที่รูปเพื่อแก้ไข/สลับเป็น AI, แปรงลบ, ปรับขอบ ·
          หรือกด “ตัดด้วย AI ทั้งชุด” เพื่อให้ AI ตัดให้ทีละตัว
        </div>
        <div className="grid">
          {stickers.map((s) => (
            <div className="card" key={s.id}>
              <div className="thumb checker" onClick={() => openEditor(s.id)} style={{ cursor: 'pointer' }}>
                {s.processing ? <div className="spin" /> : <StickerThumb sticker={s} width={stickerW} height={stickerH} margin={frameMargin} />}
                {(meta.mainStickerId === s.id) && <span className="tag" style={{ position: 'absolute', top: 6, left: 6 }}>หลัก</span>}
                {(meta.tabStickerId === s.id) && <span className="tag" style={{ position: 'absolute', top: 6, right: 6 }}>แท็บ</span>}
              </div>
              <div className="bar">
                <span className="nm">{s.name}</span>
                {s.processing
                  ? <span className="badge busy">กำลังตัด</span>
                  : s.mask
                    ? <span className="badge ok">พร้อม</span>
                    : <span className="badge warn">ไม่มีตัว</span>}
                <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => openEditor(s.id)}>✏️</button>
                <button className="btn-danger" style={{ padding: '4px 8px' }} onClick={() => removeSticker(s.id)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
