// Utils
import { loadAllFrom } from './utils'
// Assets
export const assets = loadAllFrom(require.context('./assets', false, /\.(png|jpe?g|svg|webp)$/i)) as string[]

// require.context 在旧版 react-scripts 下会把每个文件返回两次, 这里按 URL 去重即可;
// 新版构建每个文件只出现一次, Set 去重后等价于原数组, 避免再用 length/2 误删一半图片
const assetsRemoveRepeat = Array.from(new Set(assets))
// Webpack renames emitted assets to `<original name>.<20-char content hash>.<ext>`.
const CONTENT_HASH_RE = /^[0-9a-f]{20}$/
export const GALLERY_DATA = assetsRemoveRepeat.reduce((acc, cur) => {
  try {
    const parts = cur.split('/').last?.split('.') || []
    const [date, dimension, title, desc] = parts
    const [width, height] = dimension.split('×')
    // Everything between the dimensions and the extension is the category
    // (`2025-05-12.2048×1536.开幕式.jpg` → `开幕式`). Two other segments can show
    // up there and neither is a category: webpack's content hash, and the numeric
    // duplicate counter (`…开幕式.2.jpg`) added by scripts/prep-photos.js.
    const category = parts
      .slice(2, -1)
      .filter((segment) => !CONTENT_HASH_RE.test(segment) && !/^\d+$/.test(segment))
      .join('-')
    acc.push({
      date,
      width: Number(width),
      height: Number(height),
      aspectRatio: Number(width) / Number(height),
      title,
      desc,
      category: category || undefined,
      path: cur
    })
  } catch (e) {
    console.error('Loading asset error:', e)
  }
  return acc
}, [] as Pic[])
