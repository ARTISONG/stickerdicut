declare module 'upng-js' {
  const UPNG: {
    /**
     * เข้ารหัส PNG/APNG จากเฟรม RGBA
     * @param imgs ArrayBuffer ของ RGBA แต่ละเฟรม
     * @param cnum จำนวนสี (0 = lossless)
     * @param dels หน่วงเวลาแต่ละเฟรม (ms) — ใส่หลายเฟรม = APNG
     */
    encode(imgs: ArrayBuffer[], w: number, h: number, cnum: number, dels?: number[]): ArrayBuffer
    decode(buf: ArrayBuffer): { width: number; height: number; frames: unknown[] }
  }
  export default UPNG
}
