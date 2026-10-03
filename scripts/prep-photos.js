/**
 * prep-photos.js — CI-safe photo pipeline for meow (with categories).
 *
 * Filename convention produced by this script:
 *     <YYYY-MM-DD>.<w>×<h>[.<category>].<ext>        (`×` is U+00D7)
 *
 * What you may upload (dims are ALWAYS computed, never typed by hand):
 *     2025-05-12.开幕式.jpg        → date + category
 *     2025-05-12.jpg               → date only
 *     开幕式.jpg                    → EXIF date (if any) + name as label
 *     IMG_1234.jpg                 → EXIF date, else the name as label
 *     2025-05-12.2048×1536.开幕式.jpg → already canonical, left untouched
 *
 * Category = every non-date, non-dimension dot segment. Files without one show up
 * in the gallery's "未分类" group.
 *
 * Metadata (GPS + device identifiers) is scrubbed for jpg / png / webp.
 * The script is idempotent: a file whose name already carries the correct
 * dimensions is never renamed.
 *
 * Usage: node scripts/prep-photos.js [dir]     (default: src/assets)
 */

const fs = require('fs')
const path = require('path')
// image-size v1: sizeOf(path) — the function itself is the export.
// image-size v2: { imageSize } and it only accepts a Buffer, not a path.
const sizeOfModule = require('image-size')
const sizeOfIsV2 = typeof sizeOfModule !== 'function'
const sizeOf = (file) => (sizeOfIsV2 ? sizeOfModule.imageSize(fs.readFileSync(file)) : sizeOfModule(file))

const DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'src', 'assets')
const SKIP = new Set(['package.json', 'package-lock.json', 'rename.js', 'clean-meta.js', 'prep-photos.js'])
const IMG_RE = /\.(jpe?g|png|webp|svg)$/i
const DIM_RE = /^(\d+)[×xX](\d+)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const pad = (n) => String(n).padStart(2, '0')
// The gallery's parser splits the filename on '.', so no segment may contain one.
const clean = (s) => String(s).replace(/[^\w\-\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '')

function dateFromExif (file) {
  if (!/\.(jpe?g|tiff)$/i.test(file)) return null
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── metadata scrubbing (dropped fields mirror src/assets/clean-meta.js) ──
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

// ── name parsing ──
function parseName (name, full) {
  const ext = path.extname(name).toLowerCase()
  const base = name.slice(0, name.length - ext.length)
  const segs = base.split('.').filter(Boolean)
  let hasDims = false
  let dateSeg = null
  const rest = []
  for (const s of segs) {
    if (!hasDims && DIM_RE.test(s)) { hasDims = true; continue }
    if (!dateSeg && DATE_RE.test(s)) { dateSeg = s; continue }
    rest.push(s)
  }
  // No standalone date segment: pull a date out of a free segment, e.g.
  // `2025-09-09_校友返校` → date 2025-09-09 + category 校友返校.
  if (!dateSeg) {
    for (let i = 0; i < rest.length; i++) {
      const m = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/.exec(rest[i])
      if (!m) continue
      const mm = Number(m[2]); const dd = Number(m[3])
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue
      dateSeg = `${m[1]}-${pad(mm)}-${pad(dd)}`
      const remainder = rest[i].replace(m[0], '').replace(/^[-_.]+|[-_.]+$/g, '')
      if (remainder) rest[i] = remainder; else rest.splice(i, 1)
      break
    }
  }
  // A trailing pure number is the duplicate counter, never a category.
  if (rest.length && /^\d+$/.test(rest[rest.length - 1])) rest.pop()
  const exifDate = dateFromExif(full)
  const label = clean(dateSeg || exifDate || rest.shift() || 'photo') || 'photo'
  const category = clean(rest.join('-'))
  return { ext, hasDims, label, category }
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

  const { ext, hasDims, label, category } = parseName(name, full)
  const stem = `${label}.${width}×${height}${category ? '.' + category : ''}`
  const canonical = `${stem}${ext}`
  // Strictly idempotent: a name that already carries the real dimensions is final.
  // The duplicate counter (`.2`, `.3`, …) is part of that identity, otherwise the
  // script would rename `.2`→`.3`→`.2` on every build.
  const duplicatesStem = new RegExp(`^${escapeRe(stem)}\\.\\d+${escapeRe(ext)}$`)
  if (hasDims && (name === canonical || duplicatesStem.test(name))) {
    plan.push({ from: name, to: name, changed: false, category })
    continue
  }

  let target = canonical
  if (target !== name) {
    if (taken.has(target)) { // same label + size + category: keep both
      let n = 2
      while (taken.has(`${stem}.${n}${ext}`)) n++
      target = `${stem}.${n}${ext}`
    }
    taken.delete(name)
    taken.add(target)
  }
  plan.push({ from: name, to: target, changed: target !== name, category })
}

// two-phase rename so files never collide mid-flight
const changing = plan.filter((p) => p.changed)
changing.forEach((p, i) => fs.renameSync(path.join(DIR, p.from), path.join(DIR, `.tmp-${i}-${p.to}`)))
changing.forEach((p, i) => fs.renameSync(path.join(DIR, `.tmp-${i}-${p.to}`), path.join(DIR, p.to)))

let renamed = 0; let scrubbed = 0
const categories = new Map()
for (const p of plan) {
  const removed = scrub(path.join(DIR, p.to))
  if (removed) scrubbed++
  if (p.changed) { renamed++; console.log(`  改名: ${p.from}  ->  ${p.to}`) }
  const key = p.category || '(未分类)'
  categories.set(key, (categories.get(key) || 0) + 1)
}
console.log(`[prep-photos] 完成: ${plan.length} 个图片, 改名 ${renamed} 个, 抹除元数据 ${scrubbed} 个`)
if (categories.size) {
  console.log('[prep-photos] 分类统计: ' + [...categories.entries()].map(([k, v]) => `${k}=${v}`).join(', '))
}
