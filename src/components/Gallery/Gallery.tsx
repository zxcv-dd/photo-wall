// Libs
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
// Styles
import styles from './Gallery.module.scss'
// Components
import Tab from '../Tab'
import Picture from '../Picture'
// Utils
import { AppContext } from 'App.context'
import { GALLERY_DATA } from 'App.constant'
import { track } from 'utils/analytics'
import { t, resolveTitle } from 'utils/i18n'
import { siteConfig } from 'config/site.config'
import {
  DEFAULT_PICTURE_DRAG_TUNING,
  DEFAULT_PICTURE_HIGHLIGHT_TUNING,
  PictureDragTuning,
  PictureHighlightTuning
} from 'components/Picture/Picture.constant'
import { TabItemIdentifier } from 'components/Tab/Tab.constant'
import { CATEGORY_HEADER_HEIGHT, GalleryViewMode, SAFE_LABEL_HEIGHT, SAFE_PADDING, SEQUENTIAL_BREAK_POINT, STAGE_BREAK_POINT } from 'components/Gallery/Gallery.constant'
import { CategorySection, getCategoryLayout, getColumnSlot, getRandomRect, getSequentialRect, getStageRect } from './Gallery.utils'
import { useCustomScroll } from './Gallery.hook'

const IS_DEV = process.env.NODE_ENV === 'development'
// Accumulated wheel delta (px, within one gesture) needed to dismiss the
// lightbox by scrolling. Tunable from the debug panel; this is the shipped value.
const DEFAULT_WHEEL_EXIT_THRESHOLD = 70

// Stable tab order — hoisted so Tab receives the same array reference every render
// (a fresh literal would re-trigger Tab's measurement effect needlessly).
const VIEW_ITEMS = [GalleryViewMode.random, GalleryViewMode.sequential, GalleryViewMode.stage, GalleryViewMode.category]

// Sentinel bucket for photos whose filename carries no category segment.
const UNCATEGORIZED = '__uncategorized__'

// Debug-panel language choices. zh-CN / zh-TW are split out so the donate modal's
// Simplified-Chinese-only QR gating can be exercised; the rest cover the titles.
const LANG_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' },
  { value: 'pt', label: 'Português' },
  { value: 'it', label: 'Italiano' },
  { value: 'ru', label: 'Русский' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'nl', label: 'Nederlands' },
]

// Sort-direction indicator on the active tab — three left-aligned bars (a "sort
// by amount" glyph, deliberately not an arrow). Ascending = bars grow downward
// (short→long); descending reverses. Each bar's WIDTH transitions independently,
// so the glyph fluidly morphs between states rather than flipping.
// Integer px (not %) so the bar ends land on the pixel grid and stay crisp.
const SORT_BAR_WIDTHS = {
  asc: ['5px', '8px', '12px'],
  desc: ['12px', '8px', '5px'],
}
const SortIcon = ({ order }: { order: 'asc' | 'desc' }) => {
  const widths = SORT_BAR_WIDTHS[order]
  return (
    <span className={styles.sortIcon} aria-hidden="true">
      <span className={styles.sortBar} style={{ width: widths[0] }} />
      <span className={styles.sortBar} style={{ width: widths[1] }} />
      <span className={styles.sortBar} style={{ width: widths[2] }} />
    </span>
  )
}

interface GalleryProps {
  // Reports lightbox open/close so the app shell can retreat the header + dock.
  onLightboxChange?: (open: boolean) => void
}

// Card stacking bands. The dim overlay sits at z-index 150 and the enlarged photo
// at 200 (see Gallery.module.scss / Picture.tsx), so cards MUST stay below 150:
// otherwise a photo the visitor already clicked — which is raised to the front —
// ends up painted over the lightbox overlay and over the next photo they open
// (that is the "already-viewed photo covers the one I just clicked" glitch).
// Never-clicked cards use 1..CARD_BASE_MAX; click-recency cards use the band above
// it, bounded by FRONT_BAND_END.
const CARD_BASE_MAX = 19
const FRONT_BAND_START = 20
const FRONT_BAND_END = 139

// 回顾 (the first tab) is an auto-playing scatter slideshow: every few seconds a new
// batch of photos drops in while the previous batch falls away. It is not clickable.
const SLIDESHOW_INTERVAL = 5200
const SLIDESHOW_LEAVE_MS = 640
const SLIDESHOW_STAGGER_MS = 45

const Gallery = ({ onLightboxChange }: GalleryProps) => {

  // Context
  const { isInitialized, screenSize, lang, langOverride, setLangOverride } = useContext(AppContext)

  // Data
  const [data, setData] = useState<{ pic: Pic; rect: Rect }[]>([])
  const [stackIndexes, setStackIndexes] = useState<Record<string, number>>({})
  const [shuffleTokens, setShuffleTokens] = useState<Record<string, number>>({})
  // Category view: the labelled section bands drawn above their group of photos.
  const [categorySections, setCategorySections] = useState<CategorySection[]>([])
  const stackIndexesRef = useRef<Record<string, number>>({})
  // Paths the visitor has raised to the front, oldest first (last = front-most).
  // Kept as an explicit recency list instead of an ever-growing counter so card
  // z-indexes can never drift up into the overlay/lightbox bands.
  const frontOrderRef = useRef<string[]>([])

  // View Mode + sort direction. Clicking a non-active tab switches view; clicking
  // the already-active tab flips the sort order (asc = oldest→newest, top→bottom).
  const [viewMode, setViewMode] = useState<GalleryViewMode>(GalleryViewMode.sequential)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const handleModeChange = useCallback((selection?: TabItemIdentifier) => {
    const next = selection as GalleryViewMode
    if (next === viewModeRef.current) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
      track('toggle_sort', { view: GalleryViewMode[next] })
      return
    }
    setViewMode(next)
    track('switch_view', { view: GalleryViewMode[next] })
  }, [])

  const [highlightTuning, setHighlightTuning] = useState<PictureHighlightTuning>(DEFAULT_PICTURE_HIGHLIGHT_TUNING)
  const [dragTuning, setDragTuning] = useState<PictureDragTuning>(DEFAULT_PICTURE_DRAG_TUNING)
  const updateHighlightTuning = useCallback((key: keyof PictureHighlightTuning, value: number) => {
    setHighlightTuning((current) => ({
      ...current,
      [key]: value,
    }))
  }, [])
  const updateDragTuning = useCallback((key: keyof PictureDragTuning, value: number) => {
    setDragTuning((current) => ({
      ...current,
      [key]: value,
    }))
  }, [])
  const resetDebugTuning = useCallback(() => {
    setHighlightTuning(DEFAULT_PICTURE_HIGHLIGHT_TUNING)
    setDragTuning(DEFAULT_PICTURE_DRAG_TUNING)
  }, [])

  // Fill
  useEffect(() => {
    if (isInitialized) {
      // Apply sort direction by reversing the (chronological) source order; the
      // layout functions place pics in array order, so this flips the timeline.
      const ordered = sortOrder === 'desc' ? [...GALLERY_DATA].reverse() : GALLERY_DATA
      // Only the category view has section bands; clear any stale ones so a mode
      // switch can never leave headers floating over another layout.
      setCategorySections([])
      // Fill by modes
      switch (viewMode) {
        case GalleryViewMode.random:
          setData(ordered.map(pic => {
            const rect = getRandomRect(pic, screenSize)
            return { pic, rect }
          }))
          break
        case GalleryViewMode.sequential:
          const sequentialColumns = {
            current: new Array(getColumnSlot(screenSize, SEQUENTIAL_BREAK_POINT)).fill(0).map(_ => []) as Rect[][]
          }
          setData(ordered.map(pic => {
            const rect = getSequentialRect(pic, screenSize, sequentialColumns)
            return { pic, rect }
          }))
          break
        case GalleryViewMode.stage:
          const stageColumns = {
            current: new Array(getColumnSlot(screenSize, STAGE_BREAK_POINT)).fill(0).map(_ => []) as Rect[][]
          }
          setData(ordered.map(pic => {
            const rect = getStageRect(pic, screenSize, stageColumns)
            return { pic, rect }
          }))
          break
        case GalleryViewMode.category: {
          // Group by the filename's category segment; groups appear in the order
          // their first (oldest) photo does, with the uncategorized bucket last.
          const buckets = new Map<string, Pic[]>()
          ordered.forEach((pic) => {
            const key = pic.category || UNCATEGORIZED
            const bucket = buckets.get(key)
            if (bucket) bucket.push(pic)
            else buckets.set(key, [pic])
          })
          const groups = Array.from(buckets.keys())
            .sort((a, b) => (a === UNCATEGORIZED ? 1 : 0) - (b === UNCATEGORIZED ? 1 : 0))
            .map((key) => ({
              label: key === UNCATEGORIZED ? t('category.uncategorized', lang) : key,
              pics: buckets.get(key) || []
            }))
          const layout = getCategoryLayout(groups, screenSize)
          setData(layout.items)
          setCategorySections(layout.sections)
          break
        }
      }
    }
  }, [isInitialized, screenSize, viewMode, sortOrder, lang])

  useEffect(() => {
    frontOrderRef.current = []
    const nextIndexes = data.reduce((acc, item, index) => {
      acc[item.pic.path] = Math.min(index + 1, CARD_BASE_MAX)
      return acc
    }, {} as Record<string, number>)
    stackIndexesRef.current = nextIndexes
    setStackIndexes(nextIndexes)
    setShuffleTokens({})
  }, [data])

  // Custom scroll
  const scrollerRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const contentHeight = useMemo(() => {
    if (!data.length) return screenSize.height
    return data.reduce((max, item) => {
      const h = item.rect.fullHeight ?? (item.rect.height + SAFE_PADDING * 2 + SAFE_LABEL_HEIGHT)
      return Math.max(max, (item.rect.top ?? 0) + h)
    }, 0)
  }, [data, screenSize.height])
  // Wheel-to-exit: a decisive scroll while the lightbox is open dismisses it.
  // The threshold is tunable live from the debug panel (dev only) and ships at
  // its default. handleClose is defined further down, so bridge it through a ref
  // to hand the scroll hook a stable callback.
  const [wheelExitThreshold, setWheelExitThreshold] = useState(DEFAULT_WHEEL_EXIT_THRESHOLD)
  const [debugCollapsed, setDebugCollapsed] = useState(true)
  const handleCloseRef = useRef<() => void>(() => {})
  const requestLightboxExit = useCallback(() => handleCloseRef.current(), [])

  const { scrollTo, maxScroll, setScrollLocked, getCurrentScroll } = useCustomScroll(scrollerRef, thumbRef, contentHeight, screenSize.height, wheelExitThreshold, requestLightboxExit)

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [expandedScroll, setExpandedScroll] = useState(0)
  const closeTimer = useRef<number>(0)

  const handleExpand = useCallback((index: number) => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = 0
    }
    setExpandedScroll(getCurrentScroll())
    setLightboxIndex(index)
    setLightboxOpen(true)
    setScrollLocked(true)
    track('expand_photo', { date: data[index]?.pic?.date, view: GalleryViewMode[viewMode] })
  }, [data, viewMode, getCurrentScroll, setScrollLocked])

  const handleClose = useCallback(() => {
    setLightboxOpen(false)
    setScrollLocked(false)
    closeTimer.current = window.setTimeout(() => {
      setLightboxIndex(null)
      closeTimer.current = 0
    }, 700)
  }, [setScrollLocked])
  // Keep the ref pointing at the latest handleClose for the scroll hook.
  handleCloseRef.current = handleClose

  // Surface lightbox open/close to the app shell so the top header and the
  // bottom dock can crossfade out of the way of the enlarged photo.
  useEffect(() => {
    onLightboxChange?.(lightboxOpen)
  }, [lightboxOpen, onLightboxChange])

  // ── 回顾 slideshow ──────────────────────────────────────────────────────────
  // Photos are dealt out in batches and scattered down into their random spots,
  // then fall away as the next batch arrives. Nothing in this view is clickable.
  const isSlideshow = viewMode === GalleryViewMode.random
  const [slideFrame, setSlideFrame] = useState(0)
  const [slideLeaving, setSlideLeaving] = useState<number[]>([])
  const slideBatchRef = useRef<number[]>([])

  useEffect(() => {
    if (!isSlideshow) {
      setSlideFrame(0)
      setSlideLeaving([])
      slideBatchRef.current = []
      return
    }
    const id = window.setInterval(() => {
      // Don't churn while the tab is in the background.
      if (document.visibilityState === 'visible') setSlideFrame((frame) => frame + 1)
    }, SLIDESHOW_INTERVAL)
    return () => window.clearInterval(id)
  }, [isSlideshow])

  const slideBatch = useMemo<number[] | null>(() => {
    if (!isSlideshow || !data.length) return null
    // Enough cards to fill the screen at the current card size.
    const perScreen = Math.round((screenSize.width * screenSize.height) / 42000)
    const size = Math.min(data.length, Math.max(9, Math.min(26, perScreen || 9)))
    const frames = Math.ceil(data.length / size)
    const start = ((slideFrame % frames) * size) % data.length
    const batch: number[] = []
    for (let i = 0; i < size; i++) batch.push((start + i) % data.length)
    return batch
  }, [isSlideshow, data, slideFrame, screenSize.width, screenSize.height])

  useEffect(() => {
    if (!slideBatch) return
    const previous = slideBatchRef.current
    slideBatchRef.current = slideBatch
    if (!previous.length) return
    setSlideLeaving(previous)
    const timer = window.setTimeout(() => setSlideLeaving([]), SLIDESHOW_LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [slideBatch])

  const slideShown = useMemo(() => {
    if (!slideBatch) return null
    const phase = new Map<number, 'in' | 'out'>()
    const delay = new Map<number, number>()
    slideLeaving.forEach((index) => phase.set(index, 'out'))
    slideBatch.forEach((index, position) => {
      phase.set(index, 'in')
      delay.set(index, position * SLIDESHOW_STAGGER_MS)
    })
    return { phase, delay }
  }, [slideBatch, slideLeaving])

  const handleTitleClick = useCallback(() => scrollTo(0), [scrollTo])
  const handleTrackClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    scrollTo((e.clientY / screenSize.height) * maxScroll)
  }, [scrollTo, maxScroll, screenSize.height])

  const handleRequestFront = useCallback((index: number, reason: 'click' | 'drag') => {
    if (viewMode !== GalleryViewMode.random) return false
    const target = data[index]
    if (!target) return false
    const path = target.pic.path
    const order = frontOrderRef.current
    if (order[order.length - 1] === path) return false

    const nextOrder = order.filter((p) => p !== path)
    nextOrder.push(path)
    // Oldest entries fall back to the base band once the front band is full.
    while (nextOrder.length > FRONT_BAND_END - FRONT_BAND_START + 1) nextOrder.shift()
    frontOrderRef.current = nextOrder

    const nextIndexes = data.reduce((acc, item, i) => {
      acc[item.pic.path] = Math.min(i + 1, CARD_BASE_MAX)
      return acc
    }, {} as Record<string, number>)
    nextOrder.forEach((p, i) => { nextIndexes[p] = FRONT_BAND_START + i })
    stackIndexesRef.current = nextIndexes
    setStackIndexes(nextIndexes)

    if (reason === 'click') {
      setShuffleTokens((prev) => ({
        ...prev,
        [path]: (prev[path] ?? 0) + 1,
      }))
    }
    return true
  }, [data, viewMode])

  // Localized view-mode labels for the tab bar (rebuild only when lang changes).
  const viewLabels = useMemo<Record<number, string>>(() => ({
    [GalleryViewMode.random]: t('tab.random', lang),
    [GalleryViewMode.sequential]: t('tab.sequential', lang),
    [GalleryViewMode.stage]: t('tab.stage', lang),
    [GalleryViewMode.category]: t('tab.category', lang),
  }), [lang])

  return (
    <main className={`${styles.gallery}${lightboxOpen ? ` ${styles.chromeHidden}` : ''}`}>

      <header className={`${styles.header}${lightboxOpen ? ` ${styles.headerHidden}` : ''}`}>
        <h1 className={styles.title} onClick={handleTitleClick}>{resolveTitle(siteConfig.subject, lang)}</h1>
        <Tab
          value={viewMode}
          onChange={handleModeChange}
          items={VIEW_ITEMS}
          labels={viewLabels}
          activeAdornment={<SortIcon order={sortOrder} />}
        />
      </header>

      <div className={styles.scroller} ref={scrollerRef}>
        {
          viewMode === GalleryViewMode.category && categorySections.map((section) => (
            <div
              key={section.top}
              className={styles.categoryHeader}
              style={{ top: section.top, height: CATEGORY_HEADER_HEIGHT, left: SAFE_PADDING }}
              aria-hidden="true"
            >
              <span className={styles.categoryLabel}>{section.label}</span>
              <span className={styles.categoryCount}>{section.count}</span>
            </div>
          ))
        }
        {
          isInitialized && data.map((item, index) => {
            // 回顾: only the current batch (plus the one falling away) is on stage.
            if (slideShown && !slideShown.phase.has(index)) return null
            return (
            <Picture
              key={item.pic.path}
              index={index}
              pic={item.pic}
              rect={item.rect}
              // 回顾 is a slideshow: no dragging, no opening.
              draggable={false}
              highlightTuning={highlightTuning}
              dragTuning={dragTuning}
              stackIndex={stackIndexes[item.pic.path] ?? index + 1}
              shuffleToken={shuffleTokens[item.pic.path] ?? 0}
              onRequestFront={handleRequestFront}
              slideshow={isSlideshow}
              slidePhase={slideShown?.phase.get(index)}
              slideDelay={slideShown?.delay.get(index) ?? 0}
              lightbox={index === lightboxIndex}
              // Only the lightbox card reads lightboxOpen; feeding `false` to the
              // rest keeps the prop referentially stable so React.memo can skip
              // them when the lightbox opens/closes (no behavior change — a card
              // with lightbox=false ignores lightboxOpen internally).
              lightboxOpen={index === lightboxIndex ? lightboxOpen : false}
              onExpand={handleExpand}
              onClose={handleClose}
              expandedScroll={index === lightboxIndex ? expandedScroll : undefined}
            />
            )
          })
        }

        <div
          className={`${styles.overlay}${lightboxOpen ? ` ${styles.overlayVisible}` : ''}`}
          style={lightboxIndex !== null ? { top: expandedScroll, height: screenSize.height } : undefined}
          onClick={handleClose}
        />

        {/* Gives the native (touch) scroller its scroll height; invisible on desktop. */}
        <div className={styles.scrollSpacer} style={{ height: contentHeight }} aria-hidden="true" />
      </div>

      {maxScroll > 0 && (
        <div className={styles.scrollbar} onClick={handleTrackClick}>
          <div className={styles.scrollThumb} ref={thumbRef}/>
        </div>
      )}

      {IS_DEV && (
        <aside className={styles.debugPanel}>
          <div className={styles.debugHeader}>
            <button
              className={styles.debugToggle}
              type="button"
              onClick={() => setDebugCollapsed((c) => !c)}
              aria-expanded={!debugCollapsed}
            >
              <span className={`${styles.debugChevron}${debugCollapsed ? '' : ` ${styles.debugChevronOpen}`}`} aria-hidden="true">▸</span>
              <strong className={styles.debugTitle}>Card Debug</strong>
            </button>
            {!debugCollapsed && (
              <button className={styles.debugReset} type="button" onClick={resetDebugTuning}>重置</button>
            )}
          </div>

          {!debugCollapsed && (<>
          <div className={styles.debugSection}>
            <strong className={styles.debugSectionTitle}>高光</strong>

            <label className={styles.debugControl}>
              <span>亮斑强度</span>
              <strong>{highlightTuning.specularGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                value={highlightTuning.specularGain}
                onChange={(e) => updateHighlightTuning('specularGain', Number(e.target.value))}
              />
            </label>

            <label className={styles.debugControl}>
              <span>彩光强度</span>
              <strong>{highlightTuning.foilGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                value={highlightTuning.foilGain}
                onChange={(e) => updateHighlightTuning('foilGain', Number(e.target.value))}
              />
            </label>

            <label className={styles.debugControl}>
              <span>流光位移</span>
              <strong>{highlightTuning.shiftGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                value={highlightTuning.shiftGain}
                onChange={(e) => updateHighlightTuning('shiftGain', Number(e.target.value))}
              />
            </label>
          </div>

          <div className={styles.debugSection}>
            <strong className={styles.debugSectionTitle}>拖拽姿态</strong>

            <label className={styles.debugControl}>
              <span>位移滞后</span>
              <strong>{dragTuning.lagGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={dragTuning.lagGain}
                onChange={(e) => updateDragTuning('lagGain', Number(e.target.value))}
              />
            </label>

            <label className={styles.debugControl}>
              <span>倾斜强度</span>
              <strong>{dragTuning.tiltGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={dragTuning.tiltGain}
                onChange={(e) => updateDragTuning('tiltGain', Number(e.target.value))}
              />
            </label>

            <label className={styles.debugControl}>
              <span>扭转强度</span>
              <strong>{dragTuning.spinGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="3.5"
                step="0.05"
                value={dragTuning.spinGain}
                onChange={(e) => updateDragTuning('spinGain', Number(e.target.value))}
              />
            </label>

            <label className={styles.debugControl}>
              <span>加速度响应</span>
              <strong>{dragTuning.accelGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="3"
                step="0.05"
                value={dragTuning.accelGain}
                onChange={(e) => updateDragTuning('accelGain', Number(e.target.value))}
              />
            </label>

            <label className={styles.debugControl}>
              <span>抬起感</span>
              <strong>{dragTuning.liftGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                value={dragTuning.liftGain}
                onChange={(e) => updateDragTuning('liftGain', Number(e.target.value))}
              />
            </label>

            <label className={styles.debugControl}>
              <span>抓取偏心</span>
              <strong>{dragTuning.gripGain.toFixed(2)}</strong>
              <input
                type="range"
                min="0"
                max="2.5"
                step="0.05"
                value={dragTuning.gripGain}
                onChange={(e) => updateDragTuning('gripGain', Number(e.target.value))}
              />
            </label>
          </div>

          <div className={styles.debugSection}>
            <strong className={styles.debugSectionTitle}>弹窗</strong>

            <label className={styles.debugControl}>
              <span>滚轮退出阈值</span>
              <strong>{wheelExitThreshold}</strong>
              <input
                type="range"
                min="40"
                max="800"
                step="10"
                value={wheelExitThreshold}
                onChange={(e) => setWheelExitThreshold(Number(e.target.value))}
              />
            </label>
          </div>

          <div className={styles.debugSection}>
            <strong className={styles.debugSectionTitle}>本地化</strong>

            <label className={styles.debugControl}>
              <span>页面语言</span>
              <strong>{lang}</strong>
              <select
                className={styles.debugSelect}
                value={langOverride ?? ''}
                onChange={(e) => setLangOverride(e.target.value || null)}
              >
                <option value="">系统 ({navigator.language})</option>
                {LANG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          </>)}
        </aside>
      )}

    </main>
  )
}

export default Gallery
