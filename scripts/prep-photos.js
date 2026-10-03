/**
 * prep-photos.js — CI-safe photo pipeline for meow.
 *
 * Why this exists: the bundled src/assets/rename.js only scans /\.jpe?g/ (the
 * shipped demo assets are .webp), and falls back to the raw filename when EXIF has
 * no date. Uploaded phone photos are fine, but PNG/WebP uploads were skipped and
 * badly-named files rendered as broken tiles (silently: width=NaN).
 *
 * This script handles jpg/jpeg/png/webp/svg, derives the date from
 *   1. EXIF DateTimeOriginal  2. a date inside the original filename  3. the
 *   current prefix  4. the original basename (never silently broken),
 * renames to `YYYY-MM-DD.<w>×<h>.<ext>` (U+00D7) and scrubs location/device
 * metadata. It is idempotent: already-correct filenames are left alone.
 *
 * Usage: node scripts/prep-photos.js [dir]     (default: src/assets)
 */

const fs = require('fs')
const path = require('path')
const sizeOf = require('image-size')

const DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'src', 'assets')
const SKIP = new Set(['package.json', 'package-lock.json', 'rename.js', 'clean-meta.js', 'prep-photos.js'])
const IMG_RE = /\.(jpe?g|png|webp|svg)$/i
// already canonical: <label>.<w>×<h>[.<n>].<ext>  (the optional n is the duplicate counter)
const CANON_RE = /^(.+)\.(\d+)×(\d+)(?:\.(\d+))?\.([A-Za-z0-9]+)$/

const pad = (n) => String(n).padStart(2, '0')

function dateFromExif (file) {
  if (!/\.(jpe?g|jpeg|tiff)$/i.test(file)) return null
  try {
    const piexif = require('piexif')
    const exif = piexif.load(fs.readFileSync(file).toString('binary'))
    const raw = exif && exif.Exif && exif.Exif[36867] // DateTimeOriginal
    const m = /^(\d{4}):(\d{2}):(\d{2})/.exec(String(raw || ''))
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  } catch (e) { /* no readable EXIF */ }
  return null
}

function dateFromName (name) {
  const m = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/.exec(name)
  if (!m) return null
  const mm = Number(m[2]); const dd = Number(m[3])
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  return `${m[1]}-${pad(mm)}-${pad(dd)}`
}

// ── metadata scrubbing (the dropped fields mirror src/assets/clean-meta.js) ──
const SENSITIVE = { '0th': [315 /* Artist */, 316 /* HostComputer */], Exif: [42016, 42032, 42033, 42035] }

function stripJpeg (file) {
  try {
    const piexif = require('piexif')
    const binary = fs.readFileSync(file).toString('binary')
    const exif = piexif.load(binary)
    let removed = 0
    if (exif.GPS && Object.keys(exif.GPS).length) { delete exif.GPS; removed++ }
    for (const [ifd, tags] of Object.entries(SENSITIVE)) {
      if (!exif[ifd]) continue
      for (const tag of tags) if (exif[ifd][tag] !== undefined) { delete exif[ifd][tag]; removed++ }
    }
    if (removed) fs.writeFileSync(file, Buffer.from(piexif.insert(piexif.dump(exif), binary), 'binary'))
    return removed
  } catch (e) { return 0 }
}

function stripPng (file) {
  try {
    const buf = fs.readFileSync(file)
    const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (buf.length < 8 || !buf.slice(0, 8).equals(SIG)) return 0
    const DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt'])
    const keep = [SIG]
    let off = 8; let removed = 0
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off)
      const end = off + 12 + len
      if (end > buf.length) return 0 // malformed: leave the file untouched
      const type = buf.slice(off + 4, off + 8).toString('latin1')
      if (DROP.has(type)) removed++
      else keep.push(buf.slice(off, end))
      off = end
    }
    if (removed) fs.writeFileSync(file, Buffer.concat(keep))
    return removed
  } catch (e) { return 0 }
}

function stripWebp (file) {
  try {
    const buf = fs.readFileSync(file)
    if (buf.length < 16 || buf.slice(0, 4).toString('latin1') !== 'RIFF' || buf.slice(8, 12).toString('latin1') !== 'WEBP') return 0
    const chunks = []; let off = 12; let removed = 0; let vp8xIndex = -1
    while (off + 8 <= buf.length) {
      const fourcc = buf.slice(off, off + 4).toString('latin1')
      const size = buf.readUInt32LE(off + 4)
      const end = off + 8 + size + (size % 2)
      if (end > buf.length) return 0
      if (fourcc === 'EXIF' || fourcc === 'XMP ') removed++
      else { chunks.push(buf.slice(off, end)); if (fourcc === 'VP8X') vp8xIndex = chunks.length - 1 }
      off = end
    }
    if (!removed) return 0
    if (vp8xIndex >= 0) { // clear the EXIF/XMP flag bits in the VP8X flags byte
      const c = Buffer.from(chunks[vp8xIndex])
      c[8] = c[8] & ~0x0c
      chunks[vp8xIndex] = c
    }
    const body = Buffer.concat(chunks)
    const header = Buffer.alloc(12)
    buf.copy(header, 0, 0, 12)
    header.writeUInt32LE(body.length + 4, 4)
    fs.writeFileSync(file, Buffer.concat([header, body]))
    return removed
  } catch (e) { return 0 }
}

function scrub (file) {
  if (/\.(jpe?g)$/i.test(file)) return stripJpeg(file)
  if (/\.png$/i.test(file)) return stripPng(file)
  if (/\.webp$/i.test(file)) return stripWebp(file)
  return 0
}

// ── main ──
if (!fs.existsSync(DIR)) { console.log(`[prep-photos] 目录不存在, 跳过: ${DIR}`); process.exit(0) }

const files = fs.readdirSync(DIR).filter((f) => IMG_RE.test(f) && !SKIP.has(f) && fs.statSync(path.join(DIR, f)).isFile())
console.log(`[prep-photos] ${DIR} 中找到 ${files.length} 个图片`)

const plan = []
const taken = new Set(files)
for (const name of files) {
  const full = path.join(DIR, name)
  let dim
  try { dim = sizeOf(full) } catch (e) { console.log(`  ! 无法读取尺寸, 跳过: ${name} (${e.message})`); continue }
  const width = dim.width; const height = dim.height
  if (!width || !height) { console.log(`  ! 尺寸无效, 跳过: ${name}`); continue }

  const canon = CANON_RE.exec(name)
  // Strictly idempotent: if the name already carries the real dimensions, never
  // touch it (re-deriving could append another ".<w>×<h>" on every build).
  if (canon && Number(canon[2]) === width && Number(canon[3]) === height) {
    plan.push({ from: name, to: name, changed: false })
    continue
  }
  const rawLabel = dateFromExif(full) || dateFromName(name) || (canon ? canon[1] : name.replace(/\.[^.]+$/, ''))
  // The parser splits the filename on '.', so a label must not contain one.
  const label = rawLabel.replace(/[^\w\-\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'photo'
  const ext = path.extname(name).toLowerCase()
  let target = `${label}.${width}×${height}${ext}`

  if (target !== name) {
    if (taken.has(target)) { // same date + same size: keep both, append a counter
      let n = 2
      while (taken.has(`${label}.${width}×${height}.${n}${ext}`)) n++
      target = `${label}.${width}×${height}.${n}${ext}`
    }
    taken.delete(name)
    taken.add(target)
  }
  plan.push({ from: name, to: target, changed: target !== name })
}

// two-phase rename so files never collide mid-flight
const changing = plan.filter((p) => p.changed)
changing.forEach((p, i) => fs.renameSync(path.join(DIR, p.from), path.join(DIR, `.tmp-${i}-${p.to}`)))
changing.forEach((p, i) => fs.renameSync(path.join(DIR, `.tmp-${i}-${p.to}`), path.join(DIR, p.to)))

let renamed = 0; let scrubbed = 0
for (const p of plan) {
  const removed = scrub(path.join(DIR, p.to))
  if (removed) scrubbed++
  if (p.changed) { renamed++; console.log(`  改名: ${p.from}  ->  ${p.to}`) }
}
console.log(`[prep-photos] 完成: ${plan.length} 个图片, 改名 ${renamed} 个, 抹除元数据 ${scrubbed} 个`)

const bad = fs.readdirSync(DIR).filter((f) => IMG_RE.test(f) && !SKIP.has(f)).filter((f) => !CANON_RE.test(f))
if (bad.length) console.log(`[prep-photos] 警告: 以下文件仍不符合 名称.宽×高.扩展名 规范, 可能显示异常: ${bad.join(', ')}`)
