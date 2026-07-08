import { useEffect, useRef } from 'react'
import type { Sticker } from '../types'
import { renderSticker } from '../lib/pipeline'

interface Props {
  sticker: Sticker
  width: number
  height: number
  /** ระยะเว้นขอบว่างในเฟรม (px) */
  margin?: number
}

/** วาดผลลัพธ์ die-cut ของสติกเกอร์ลง canvas (พื้นหลังลายหมากรุกโปร่งใส) */
export function StickerThumb({ sticker, width, height, margin = 0 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const out = renderSticker(sticker, width, height, margin)
    canvas.width = out.width
    canvas.height = out.height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, out.width, out.height)
    ctx.drawImage(out, 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sticker.mask, sticker.borderWidth, sticker.enhance, sticker.layout, sticker.maskWidth, sticker.maskHeight, width, height, margin])

  return <canvas ref={ref} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block' }} />
}
