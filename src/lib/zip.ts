// ---- สร้างไฟล์ ZIP ตามโครงสร้าง LINE ----

import JSZip from 'jszip'
import type { Sticker, ProjectMeta } from '../types'
import { SPEC } from '../constants'
import { exportPng } from './pipeline'

export interface ZipBuildResult {
  blob: Blob
  totalBytes: number
  overLimit: boolean
  /** รายละเอียดขนาดแต่ละไฟล์ */
  files: { name: string; bytes: number }[]
}

export interface ExportSizes {
  stickerW: number
  stickerH: number
  mainW: number
  mainH: number
  tabW: number
  tabH: number
  margin: number
}

/**
 * สร้าง ZIP:
 *   01.png .. NN.png  (สติกเกอร์)
 *   main.png          (รูปหลัก)
 *   tab.png           (รูปแท็บ)
 */
export async function buildZip(
  stickers: Sticker[],
  meta: ProjectMeta,
  sizes: ExportSizes,
  onProgress?: (done: number, total: number) => void,
): Promise<ZipBuildResult> {
  const zip = new JSZip()
  const files: { name: string; bytes: number }[] = []
  let total = 0

  const totalSteps = stickers.length + 2
  let step = 0

  // สติกเกอร์หลัก
  for (let i = 0; i < stickers.length; i++) {
    const { blob } = await exportPng(stickers[i], sizes.stickerW, sizes.stickerH, sizes.margin)
    const name = `${String(i + 1).padStart(2, '0')}.png`
    zip.file(name, blob)
    files.push({ name, bytes: blob.size })
    total += blob.size
    onProgress?.(++step, totalSteps)
  }

  // main.png
  const mainSticker =
    stickers.find((s) => s.id === meta.mainStickerId) ?? stickers[0]
  if (mainSticker) {
    const { blob } = await exportPng(mainSticker, sizes.mainW, sizes.mainH, sizes.margin)
    zip.file('main.png', blob)
    files.push({ name: 'main.png', bytes: blob.size })
    total += blob.size
  }
  onProgress?.(++step, totalSteps)

  // tab.png
  const tabSticker =
    stickers.find((s) => s.id === meta.tabStickerId) ?? mainSticker
  if (tabSticker) {
    const { blob } = await exportPng(tabSticker, sizes.tabW, sizes.tabH, sizes.margin)
    zip.file('tab.png', blob)
    files.push({ name: 'tab.png', bytes: blob.size })
    total += blob.size
  }
  onProgress?.(++step, totalSteps)

  const blob = await zip.generateAsync({ type: 'blob' })
  return {
    blob,
    totalBytes: blob.size,
    overLimit: blob.size > SPEC.MAX_ZIP_BYTES,
    files,
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
