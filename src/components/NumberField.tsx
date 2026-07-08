import { useEffect, useState } from 'react'

interface Props {
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  /** ปรับค่าก่อนบันทึก เช่น บังคับเลขคู่ */
  normalize?: (v: number) => number
  width?: number
  title?: string
}

/**
 * ช่องตัวเลขที่พิมพ์/ลบได้อิสระระหว่างแก้ แล้วค่อย clamp/normalize ตอน blur หรือ Enter
 * ใช้ inputMode="numeric" ให้มือถือเด้งแป้นตัวเลข (type="number" เดิมพิมพ์/ลบยากบนมือถือ)
 */
export function NumberField({ value, onCommit, min, max, normalize, width = 90, title }: Props) {
  const [text, setText] = useState(String(value))

  // sync เมื่อค่าภายนอกเปลี่ยน (เช่นเปลี่ยน preset)
  useEffect(() => { setText(String(value)) }, [value])

  function commit() {
    let v = parseInt(text, 10)
    if (Number.isNaN(v)) { setText(String(value)); return } // ว่าง/ไม่ใช่เลข -> คืนค่าเดิม
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    if (normalize) v = normalize(v)
    setText(String(v))
    if (v !== value) onCommit(v)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      title={title}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
      style={{ width }}
    />
  )
}
