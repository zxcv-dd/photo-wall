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
