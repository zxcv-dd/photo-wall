import { range } from 'utils'
import {
  CATEGORY_BREAK_POINT,
  CATEGORY_HEADER_HEIGHT,
  CATEGORY_ROW_GAP,
  RANDOM_MAX_WIDTH,
  RANDOM_MIN_WIDTH,
  SAFE_LABEL_HEIGHT,
  SAFE_PADDING,
  SEQUENTIAL_BREAK_POINT,
  STAGE_BREAK_POINT,
  STAGE_HORIZONTAL_BASE_CONTINUOUS,
  STAGE_RATIO_BREAK_POINT,
  STAGE_VERTICAL_BASE_CONTINUOUS
} from 'components/Gallery/Gallery.constant'

// COMMON
// Phones need their own column rule: a fixed break point (300–400px) collapses to a
// single, screen-filling column there, which is far too large. Below this width we
// fall back to a minimum card width instead, so a 390px viewport gets 2 columns.
const NARROW_SCREEN_WIDTH = 700
const NARROW_MIN_CARD_WIDTH = 190

export const getColumnSlot = (screenSize: Size, breakPoint: number) => {
  // Guard: empty screen size
  if (!screenSize) return 1
  // Guard: small screen
  const slots = Math.floor(screenSize.width / breakPoint) || 1
  if (screenSize.width >= NARROW_SCREEN_WIDTH) return slots
  const byMinWidth = Math.floor(screenSize.width / NARROW_MIN_CARD_WIDTH) || 1
  return Math.max(2, Math.min(3, byMinWidth))
}

// RANDOM
const getRandomSize = (aspectRatio: number, screenSize?: Size) => {
  let width = range(RANDOM_MIN_WIDTH, RANDOM_MAX_WIDTH)
  // Keep a scattered card inside the viewport on phones (RANDOM_MAX_WIDTH alone can
  // exceed the screen, which pushed cards off the edge).
  if (screenSize?.width) width = Math.min(width, Math.max(140, screenSize.width - 4 * SAFE_PADDING))
  const height = width / aspectRatio
  return {
    width,
    height,
  }
}
const getRandomPosition = (screenSize: Size, imageSize: Size, angle: number) => {
  // Total element size including padding on both sides
  const totalW = imageSize.width + 2 * SAFE_PADDING
  const totalH = imageSize.height + 2 * SAFE_PADDING + SAFE_LABEL_HEIGHT
  // Rotated bounding box expansion from rotation
  const rad = Math.abs(angle) * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const extraX = ((totalW * cos + totalH * sin) - totalW) / 2
  const extraY = ((totalW * sin + totalH * cos) - totalH) / 2
  // Constrain within viewport
  const minLeft = extraX
  const maxLeft = screenSize.width - totalW - extraX
  const minTop = extraY
  const maxTop = screenSize.height - totalH - extraY
  return {
    left: range(Math.max(0, minLeft), Math.max(minLeft, maxLeft)),
    top: range(Math.max(0, minTop), Math.max(minTop, maxTop)),
  }
}
export const getRandomRect = (data: Pic, screenSize: Size) => {
  const imageSize = getRandomSize(data.aspectRatio, screenSize)
  const angle = range(-20, 20)
  const { left, top } = getRandomPosition(screenSize, imageSize, angle)
  return {
    left,
    top,
    angle,
    width: imageSize.width,
    height: imageSize.height,
  }
}

// SLIDESHOW (回顾)
// Lays one batch out as a tight pile: each photo owns a grid cell (so nothing gets
// buried) but is placed near the cell centre with a small jitter, and the cards are
// sized close to the cell so the batch reads as a scattered stack rather than a rigid,
// widely spaced grid.
export const getSlideshowRects = (
  batch: number[],
  data: { pic: Pic; rect: Rect }[],
  screenSize: Size,
): Map<number, Rect> => {
  const rects = new Map<number, Rect>()
  const count = batch.length
  if (!count || !screenSize?.width || !screenSize?.height) return rects
  // Keep clear of the title/tabs band at the top.
  const headerInset = Math.min(150, screenSize.height * 0.13)
  const usableW = screenSize.width - SAFE_PADDING * 2
  const usableH = screenSize.height - headerInset - SAFE_PADDING * 2
  const cols = Math.max(1, Math.round(Math.sqrt(count * (usableW / usableH))))
  const rows = Math.ceil(count / cols)
  const cellW = usableW / cols
  const cellH = usableH / rows
  const CARD_FILL = 0.95      // card vs cell — near 1 keeps the pile tight
  const JITTER = 0.13         // how far off centre a card may sit (fraction of cell)
  batch.forEach((index, position) => {
    const item = data[index]
    if (!item) return
    const aspect = item.pic.aspectRatio || 1
    const maxW = Math.max(56, cellW * CARD_FILL - SAFE_PADDING * 2)
    const maxH = Math.max(56, cellH * CARD_FILL - SAFE_PADDING * 2 - SAFE_LABEL_HEIGHT)
    let width = maxW
    let height = width / aspect
    if (height > maxH) {
      height = maxH
      width = height * aspect
    }
    const col = position % cols
    const row = Math.floor(position / cols)
    const cardW = width + SAFE_PADDING * 2
    const cardH = height + SAFE_PADDING * 2 + SAFE_LABEL_HEIGHT
    const left = SAFE_PADDING + col * cellW + (cellW - cardW) / 2 + range(-cellW * JITTER, cellW * JITTER)
    const top = headerInset + row * cellH + (cellH - cardH) / 2 + range(-cellH * JITTER, cellH * JITTER)
    const angle = range(-6, 6)
    rects.set(index, {
      left,
      top,
      width,
      height,
      angle,
      fullWidth: cardW,
      fullHeight: cardH,
    })
  })
  return rects
}

// SEQUENTIAL
const getSequentialColumn = (columnsRef: { current: Rect[][] }) => {  const columnHeights = columnsRef.current.map((column) => column.reduce((acc, item) => acc + (item.fullHeight ?? item.height), 0))
  const minColumnHeight = Math.min(...columnHeights)
  const indexOfFirstMinColumn = columnHeights.indexOf(minColumnHeight)
  return {
    height: minColumnHeight,
    index: indexOfFirstMinColumn,
  }
}
const getSequentialSize = (screenSize: Size, data: Pic) => {
  const base = ((screenSize.width - 2 * SAFE_PADDING) / getColumnSlot(screenSize, SEQUENTIAL_BREAK_POINT)) - (2 * SAFE_PADDING)
  const width = base
  const height = base / data.aspectRatio + SAFE_PADDING * 2
  const fullWidth = base + SAFE_PADDING * 2
  const fullHeight = height + SAFE_PADDING * 2 + SAFE_LABEL_HEIGHT
  return {
    base,
    width,
    height,
    fullWidth,
    fullHeight,
  }
}
const getSequentialPosition = (screenSize: Size, column: ReturnType<typeof getSequentialColumn>, imageSize: ReturnType<typeof getSequentialSize>) => {
  const left = column.index * (imageSize.base + SAFE_PADDING * 2) + SAFE_PADDING
  const top = column.height + SAFE_PADDING * 2
  return {
    left,
    top,
  }
}
export const getSequentialRect = (data: Pic, screenSize: Size, columnsRef: { current: Rect[][] }) => {
  const column = getSequentialColumn(columnsRef)
  const size = getSequentialSize(screenSize, data)
  const position = getSequentialPosition(screenSize, column, size)
  const rect = {
    ...size,
    ...position,
    angle: 0,
  }
  columnsRef.current[column.index]?.push(rect)
  return rect
}

// STAGE
const getStageColumn = (columnsRef: { current: Rect[][] }) => {
  const columnHeights = columnsRef.current.map((column) => Math.floor(column.reduce((acc, item) => acc + (item.fullHeight ?? item.height), 0)))
  const minColumnHeight = Math.min(...columnHeights)
  const indexOfFirstMinColumn = columnHeights.indexOf(minColumnHeight)
  let continuousFitCount = 0
  while (columnHeights[indexOfFirstMinColumn + continuousFitCount + 1] === minColumnHeight) {
    continuousFitCount++
  }
  const isSlotFit = continuousFitCount + 1 >= STAGE_HORIZONTAL_BASE_CONTINUOUS
  return {
    height: minColumnHeight,
    index: indexOfFirstMinColumn,
    // 空间是否足够容纳 STAGE_HORIZONTAL_BASE_CONTINUOUS
    fitHorizontal: isSlotFit,
  }
}
const getStageSize = (screenSize: Size, data: Pic, column: ReturnType<typeof getStageColumn>) => {
  const base = ((screenSize.width - 2 * SAFE_PADDING) / getColumnSlot(screenSize, STAGE_BREAK_POINT)) - (2 * SAFE_PADDING)
  let slot: number
  let width: number
  let height: number
  const isRandomSquare = range(0, 5) < 1
  const horizontalGap = SAFE_PADDING * 2 * (STAGE_HORIZONTAL_BASE_CONTINUOUS - 1)
  const verticalGap = (SAFE_PADDING * 2 + SAFE_LABEL_HEIGHT) * (STAGE_VERTICAL_BASE_CONTINUOUS - 1)
  if (data.aspectRatio > STAGE_RATIO_BREAK_POINT.HORIZONTAL && column.fitHorizontal && !isRandomSquare) {
    // Horizontal
    slot = STAGE_HORIZONTAL_BASE_CONTINUOUS
    width = base * STAGE_HORIZONTAL_BASE_CONTINUOUS + horizontalGap
    height = base
  } else if (data.aspectRatio < STAGE_RATIO_BREAK_POINT.VERTICAL && !isRandomSquare) {
    // Vertical
    slot = 1
    width = base
    height = base * STAGE_VERTICAL_BASE_CONTINUOUS + verticalGap
  } else {
    // Square
    const isRandomSquareLarge = range(0, 3) < 1
    if (isRandomSquareLarge && column.fitHorizontal) {
      slot = STAGE_HORIZONTAL_BASE_CONTINUOUS
      width = base * STAGE_HORIZONTAL_BASE_CONTINUOUS + horizontalGap
      height = base * STAGE_VERTICAL_BASE_CONTINUOUS + verticalGap
    } else {
      slot = 1
      width = base
      height = base
    }
  }
  const fullWidth = width + SAFE_PADDING * 2
  const fullHeight = height + SAFE_PADDING * 2 + SAFE_LABEL_HEIGHT
  return {
    slot,
    base,
    width,
    height,
    fullWidth,
    fullHeight,
  }
}
const getStagePosition = (screenSize: Size, column: ReturnType<typeof getStageColumn>, imageSize: ReturnType<typeof getStageSize>) => {
  const left = column.index * (imageSize.base + SAFE_PADDING * 2) + SAFE_PADDING
  const top = column.height + SAFE_PADDING * 2
  return {
    left,
    top,
  }
}
export const getStageRect = (data: Pic, screenSize: Size, columnsRef: { current: Rect[][] }) => {
  const column = getStageColumn(columnsRef)
  const size = getStageSize(screenSize, data, column)
  const position = getStagePosition(screenSize, column, size)
  const rect = {
    ...size,
    ...position,
    angle: 0,
  }
  for (let i = 0; i <= size.slot - 1; i++) {
    columnsRef.current[column.index + i]?.push(rect)
  }
  return rect
}

// CATEGORY — each category is its own labelled section: a header band, then that
// category's photos packed into rows of equal-width columns (uniform grid, so a
// section reads as one block instead of a running masonry). Each header band is
// baked into the `top` of the photos below it, which is why the gallery's
// existing content-height formula needs no change.
export interface CategorySection {
  label: string
  top: number
  count: number
}
export interface CategoryGroup {
  label: string
  pics: Pic[]
}
export const getCategoryLayout = (groups: CategoryGroup[], screenSize: Size) => {
  const slots = getColumnSlot(screenSize, CATEGORY_BREAK_POINT)
  const base = ((screenSize.width - 2 * SAFE_PADDING) / slots) - (2 * SAFE_PADDING)
  const items: { pic: Pic; rect: Rect }[] = []
  const sections: CategorySection[] = []
  let cursor = SAFE_PADDING * 2

  groups.forEach((group) => {
    sections.push({ label: group.label, top: cursor, count: group.pics.length })
    cursor += CATEGORY_HEADER_HEIGHT
    for (let i = 0; i < group.pics.length; i += slots) {
      const row = group.pics.slice(i, i + slots)
      // A zero/absent aspect ratio would emit `NaNpx` and break the FLIP maths.
      const heights = row.map((pic) => base / (pic.aspectRatio > 0 ? pic.aspectRatio : 1))
      const rowHeight = Math.max(...heights)
      // Snapshot the running Y: the closure below must not capture `cursor`,
      // which is reassigned on every iteration (`no-loop-func`).
      const rowTop = cursor
      row.forEach((pic, column) => {
        items.push({
          pic,
          rect: {
            left: column * (base + SAFE_PADDING * 2) + SAFE_PADDING,
            top: rowTop,
            angle: 0,
            width: base,
            height: heights[column],
            fullWidth: base + SAFE_PADDING * 2,
            fullHeight: rowHeight + SAFE_PADDING * 2 + SAFE_LABEL_HEIGHT,
          },
        })
      })
      cursor += rowHeight + SAFE_PADDING * 2 + SAFE_LABEL_HEIGHT + CATEGORY_ROW_GAP
    }
  })

  return { items, sections }
}
