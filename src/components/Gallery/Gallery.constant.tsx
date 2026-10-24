import { PARALLAX_INNER_PADDING } from 'components/Parallax/Parallax.constant'
import {
  PICTURE_INNER_PADDING,
  PICTURE_LABEL_LINE_HEIGHT,
  PICTURE_LABEL_MARGIN_BOTTOM,
  PICTURE_LABEL_MARGIN_TOP
} from 'components/Picture/Picture.constant'

export const SAFE_PADDING = PARALLAX_INNER_PADDING + PICTURE_INNER_PADDING
export const SAFE_LABEL_HEIGHT = PICTURE_LABEL_LINE_HEIGHT + PICTURE_LABEL_MARGIN_TOP + PICTURE_LABEL_MARGIN_BOTTOM

export enum GalleryViewMode {
  random,
  sequential,
  stage,
  category,
}

// UI strings (titles, view labels, donate copy) now live in `utils/i18n`.

// RANDOM
export const RANDOM_MIN_WIDTH = 200
export const RANDOM_MAX_WIDTH = 400

// SEQUENTIAL
export const SEQUENTIAL_BREAK_POINT = 300

// STAGE
export const STAGE_BREAK_POINT = 400
export const STAGE_RATIO_BREAK_POINT = {
  // 中间值则按方形约束, 基准 1:1
  VERTICAL: 0.8, // 大于此值被认定为竖直图像, 基准 1:2
  HORIZONTAL: 1.2, // 小于此值被认定为水平图像, 基准 2:1
}
export const STAGE_VERTICAL_BASE_CONTINUOUS = 2 // 垂直连续基准数
export const STAGE_HORIZONTAL_BASE_CONTINUOUS = 2 // 水平连续基准数

// CATEGORY — sectioned album: a header band per category, then that category's
// photos packed into rows. Slightly narrower columns than SEQUENTIAL so ~4 fit
// on a desktop viewport and the section reads as its own block.
export const CATEGORY_BREAK_POINT = 340
export const CATEGORY_HEADER_HEIGHT = 46
export const CATEGORY_ROW_GAP = 28

// 庆典 (the timeline tab, GalleryViewMode.sequential) is the anniversary feature
// view: it shows only the photos of these events instead of the whole archive. The
// captions of the 20th-anniversary set all start with one of these prefixes, which
// keeps older 2026 events (e.g. 26四月团建) out of it.
export const FEATURE_LABEL_PREFIXES = ['26年庆典', '26年团建']

// `date` holds the filename's first segment, i.e. the caption shown under a photo.
export const isFeaturePic = (pic: { date?: string }): boolean =>
  FEATURE_LABEL_PREFIXES.some((prefix) => (pic.date || '').startsWith(prefix))

// Order of the sub-groups inside the feature view: the ceremony first, then the
// team-building (团建 always ends up last), each in the order the day happened.
const FEATURE_GROUP_ORDER = ['分享', '现场', '草坪', '晚会']

// "26年庆典-分享-3" -> { prefix: '26年庆典', group: '分享', index: 3 }
// scripts/prep-photos.js sanitises the filename and turns the middle dot into a dash,
// so accept both "·" and "-" here (the local dev build keeps the dot).
const parseFeatureCaption = (caption: string) => {
  const normalised = caption.replace(/\u00b7/g, '-')
  const prefix = FEATURE_LABEL_PREFIXES.find((p) => normalised.startsWith(p)) || normalised
  const rest = normalised.slice(prefix.length).replace(/^-/, '')
  const dash = rest.lastIndexOf('-')
  return {
    prefix,
    group: dash >= 0 ? rest.slice(0, dash) : rest,
    index: dash >= 0 ? Number(rest.slice(dash + 1)) || 0 : 0,
  }
}

// Deterministic order for the 庆典 tab: event order first (庆典 before 团建), then the
// sub-group order, then the photo number (so -2 comes before -10).
export const compareFeaturePics = (a: { date?: string }, b: { date?: string }): number => {
  const pa = parseFeatureCaption(a.date || '')
  const pb = parseFeatureCaption(b.date || '')
  const ra = FEATURE_LABEL_PREFIXES.indexOf(pa.prefix)
  const rb = FEATURE_LABEL_PREFIXES.indexOf(pb.prefix)
  if (ra !== rb) return ra - rb
  const ga = FEATURE_GROUP_ORDER.indexOf(pa.group)
  const gb = FEATURE_GROUP_ORDER.indexOf(pb.group)
  const na = ga < 0 ? FEATURE_GROUP_ORDER.length : ga
  const nb = gb < 0 ? FEATURE_GROUP_ORDER.length : gb
  if (na !== nb) return na - nb
  return pa.index - pb.index
}

// Pulls the leading year out of a category label ("2014欢送" -> 2014, "回忆" -> null)
// so the category view can be ordered chronologically.
export const categoryYear = (category: string): number | null => {
  const match = category.match(/(19|20)\d{2}/)
  return match ? Number(match[0]) : null
}
