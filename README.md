# ✂️ Dicut — ตัดพื้นหลังสติกเกอร์อัตโนมัติ

Webapp สำหรับ **die-cut (ตัดพื้นหลัง) สติกเกอร์อัตโนมัติ** พร้อมขอบขาว 2px แล้ว export เป็น PNG โปร่งใสตามสเปก **LINE Sticker**

ทำงาน **ในเบราว์เซอร์ล้วน** — รูปไม่ถูกอัปโหลดขึ้นเซิร์ฟเวอร์ ประมวลผลบนเครื่องผู้ใช้ทั้งหมด

## ฟีเจอร์

- 📥 **อัปโหลดได้ทั้งชีตรวมและไฟล์เดี่ยว**
  - `ไฟล์เดี่ยว` — 1 ไฟล์ = 1 สติกเกอร์
  - `แยกแบบตาราง` — หั่นชีตเป็น R×C อัตโนมัติ
  - `แยกอัตโนมัติ` — ตรวจจับก้อนสติกเกอร์จากพื้นหลังสีเดียว
- 🤖 **Die-cut 2 แบบ**: AI (`@imgly/background-removal`, รันในเบราว์เซอร์) + Chroma key (เลือกสีพื้นหลัง)
- 🖌️ **แต่งด้วยมือ**: แปรงลบพื้นหลังที่เหลือ / คืนค่าส่วนที่ถูกตัดเกิน
- ⬜ **ขอบขาว 2px** อัตโนมัติ (ปรับความหนาได้ 0–12px)
- 🔢 **กำหนดจำนวนสติกเกอร์** เปลี่ยนได้จนกดล็อกชุด (ยื่นพิจารณา)
- 📤 **Export PNG** ตามสเปก LINE + สร้าง ZIP

## สเปกที่รองรับ (LINE Sticker)

| เงื่อนไข | การจัดการ |
|---------|-----------|
| PNG ทั้งหมด | output เป็น `.png` เท่านั้น |
| ความกว้าง/สูงเป็นเลขคู่ | บังคับปัดเป็นเลขคู่อัตโนมัติ |
| ≥ 72 dpi, โหมด RGB | ฝัง pHYs chunk 72dpi, output RGBA |
| แต่ละไฟล์ ≤ 1MB | ตรวจ + เตือน |
| ZIP ≤ 60MB | ตรวจ + เตือน |
| พื้นหลังโปร่งใส | transparent PNG |
| รูปหลัก 240×240 | `main.png` |
| แท็บห้องแชท 96×74 | `tab.png` |
| ขนาดสติกเกอร์ | dropdown พรีเซ็ต + กำหนดเอง (สูงสุด 370×320) |

**โครงสร้าง ZIP:** `01.png … NN.png` + `main.png` + `tab.png`

## การใช้งาน

```bash
npm install
npm run dev      # เปิด http://localhost:5173
npm run build    # build production ไป dist/
```

## โครงสร้างโค้ด

```
src/
  lib/
    canvas.ts     helper canvas / ImageData
    chroma.ts     chroma key + flood fill จากขอบ
    ai.ts         AI background removal (imgly)
    segment.ts    หั่นชีต: grid / connected-component blobs
    compose.ts    die-cut + ขอบขาว + trim
    resize.ts     fit ลงกรอบเป้าหมาย + บังคับเลขคู่
    png.ts        ฝัง pHYs chunk (DPI)
    pipeline.ts   mask → compose → resize → PNG + ตรวจสเปก
    zip.ts        สร้าง ZIP ตามโครงสร้าง LINE
  components/
    ManageScreen  ตั้งค่าชุด + อัปโหลด + กริดสติกเกอร์
    EditScreen    แก้ไขทีละตัว (แปรง, method, ขอบ)
    ExportScreen  เลือก main/tab + ตรวจสเปก + ดาวน์โหลด ZIP
    UploadZone / StickerThumb
  store.ts        สถานะรวม (zustand)
```

## เทคโนโลยี

React 18 · Vite · TypeScript · Canvas API · `@imgly/background-removal` · JSZip · Zustand
