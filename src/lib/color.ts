// ---- ยูทิลิตี้สี: HSV/HSL แปลงไปมา + เพิ่มความสดใส ----

/** RGB (0-255) -> HSV (h:0-360, s:0-1, v:0-1) */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return [h, s, max]
}

/** ระยะห่างของ hue (องศา) 0-180 */
export function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** RGB (0-255) -> HSL */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0, s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/**
 * เพิ่มความสดใส (vibrance): ดันความอิ่มสี + คอนทราสต์เบาๆ
 * @param amount 0 = ไม่เปลี่ยน, 1 = สดใสสุด
 * @returns [r,g,b] ใหม่ (0-255)
 */
export function enhanceRgb(r: number, g: number, b: number, amount: number): [number, number, number] {
  if (amount <= 0) return [r, g, b]
  const [h, s, l] = rgbToHsl(r, g, b)
  // vibrance: เพิ่ม saturation มากขึ้นกับสีที่ยังไม่อิ่ม (natural กว่าการคูณตรงๆ)
  const boosted = s + (1 - s) * s * amount * 1.1 + s * amount * 0.25
  const ns = Math.min(1, boosted)
  // คอนทราสต์เบาๆ รอบกลางโทน
  const nl = Math.min(1, Math.max(0, l + (l - 0.5) * amount * 0.12))
  return hslToRgb(h, ns, nl)
}
