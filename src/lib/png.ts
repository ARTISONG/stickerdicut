// ---- ฝัง pHYs chunk (ตั้งค่า DPI) ลงไฟล์ PNG ----
// canvas.toBlob ไม่ตั้ง DPI ให้ เราจึงแทรก pHYs chunk เองเพื่อรับประกัน >= 72 dpi

/** CRC32 สำหรับ PNG chunk */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * แทรก/แทนที่ pHYs chunk เพื่อกำหนด DPI
 * @param dpi จุดต่อนิ้ว (default 72)
 */
export async function setPngDpi(blob: Blob, dpi = 72): Promise<Blob> {
  const buf = new Uint8Array(await blob.arrayBuffer())

  // pixels per meter = dpi / 0.0254
  const ppm = Math.round(dpi / 0.0254)
  const data = new Uint8Array(9)
  const dv = new DataView(data.buffer)
  dv.setUint32(0, ppm) // X
  dv.setUint32(4, ppm) // Y
  data[8] = 1 // unit = meter

  // สร้าง pHYs chunk: length(4) + "pHYs"(4) + data(9) + crc(4)
  const type = new Uint8Array([0x70, 0x48, 0x59, 0x73]) // "pHYs"
  const typeAndData = new Uint8Array(4 + 9)
  typeAndData.set(type, 0)
  typeAndData.set(data, 4)
  const crc = crc32(typeAndData)

  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const cv = new DataView(chunk.buffer)
  cv.setUint32(0, 9) // length
  chunk.set(type, 4)
  chunk.set(data, 8)
  cv.setUint32(17, crc)

  // หา IHDR (chunk แรกหลัง signature 8 bytes) เพื่อวาง pHYs ต่อจากนั้น
  // signature 8 + IHDR: length(4)+type(4)+13+crc(4) = 8 + 25 = 33
  const insertPos = 33

  // เผื่อมี pHYs เดิม ให้ข้ามไป (ตรวจแบบง่าย: ถ้า chunk ถัดไปเป็น pHYs)
  let existingLen = 0
  if (
    buf[insertPos + 4] === 0x70 && buf[insertPos + 5] === 0x48 &&
    buf[insertPos + 6] === 0x59 && buf[insertPos + 7] === 0x73
  ) {
    const dvOld = new DataView(buf.buffer, buf.byteOffset + insertPos, 4)
    existingLen = dvOld.getUint32(0) + 12 // length field + type+data+crc
  }

  const out = new Uint8Array(buf.length - existingLen + chunk.length)
  out.set(buf.subarray(0, insertPos), 0)
  out.set(chunk, insertPos)
  out.set(buf.subarray(insertPos + existingLen), insertPos + chunk.length)

  return new Blob([out], { type: 'image/png' })
}
