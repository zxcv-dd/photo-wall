// ─────────────────────────────────────────────────────────────────────────────
// SITE CONFIG — the single place every owner-specific / personalizing value lives.
//
// This fork: 科技创新实验室 (Sci-Tech Innovation Lab) · 20周年纪念
// Photos live in src/assets. The reusable engine (src/components, src/style,
// hooks) reads NONE of this directly — only the site layer (src/site) and the
// build consume it.
//
// Everything leak-prone is OFF/empty below, so this site never sends donations /
// analytics / cross-promo clicks to the original author of the template.
// ─────────────────────────────────────────────────────────────────────────────

// Build-time primitives live in a JSON sibling so the Node build scripts
// (scripts/build-code.js — CNAME + gtag id injection) and the TS runtime read the
// SAME source. Edit site.config.json to retarget the domain / GA id.
import buildConfig from './site.config.json'

// Per-language string map: full tag (zh-cn) → primary subtag (zh) → en fallback.
export type LocaleMap = Partial<Record<string, string>>

export interface SubjectConfig {
  // The subject's name per language. Drives the page title via the engine's
  // per-language templates ("{name}'s Story"), so a fork can set just this and
  // get all 16 languages for free.
  name: LocaleMap
  // Optional fully-authored per-language title that wins over the template — for
  // titles that aren't a mechanical "{name}'s Story".
  title?: LocaleMap
}

export interface DonateConfig {
  // Master switch. When false, no donate button renders.
  enabled: boolean
  paypalUrl: string
  buyMeACoffeeUrl: string
  // Mainland-only QR images (public-relative, no leading slash). Shown only to
  // Simplified-Chinese visitors.
  alipayQr: string
  wechatQr: string
}

export interface DockProjectConfig {
  id: string
  name: string
  // Base destination URL. UTM tags are appended by the dock when `utm` is true.
  href: string
  // Public-relative icon path, no leading slash (e.g. 'projects/mos.png').
  icon: string
  iconScale?: number
  taglineKey: string
  noteKey?: string
  // Append the shared cross-promo UTM tags to the href (own-repo/self links: false).
  utm?: boolean
}

export interface DockConfig {
  // Master switch. When false, the whole cross-promo dock + invite is hidden.
  enabled: boolean
  projects: DockProjectConfig[]
  // UTM tags appended to projects with `utm: true`. `source` is the site domain.
  utm: { medium: string; campaign: string; content: string }
}

export interface SiteConfig {
  // Who the gallery is about. The one thing a fork must set.
  subject: SubjectConfig
  // GA4 measurement id. Empty string → analytics fully disabled.
  ga4MeasurementId: string
  // Custom domain → also used as the UTM `utm_source` for cross-promo links.
  domain: string
  // Browser-tab <title> (build-injected into index.html; also set at runtime).
  htmlTitle: string
  donate: DonateConfig
  dock: DockConfig
}

// Fork-safe defaults: a copy of this with your own subject is the safe starting
// point — nothing reaches the original author.
export const BLANK_SITE_CONFIG: SiteConfig = {
  subject: { name: { en: 'Your Subject' } },
  ga4MeasurementId: '',
  domain: '',
  htmlTitle: '',
  donate: { enabled: false, paypalUrl: '', buyMeACoffeeUrl: '', alipayQr: '', wechatQr: '' },
  dock: { enabled: false, projects: [], utm: { medium: 'referral', campaign: 'cross-promo', content: 'footer-dock' } },
}

// ─── THIS SITE (科技创新实验室 · 20周年纪念) ───
export const siteConfig: SiteConfig = {
  // The lab's name per language. `title` below overrides the mechanical
  // "{name}成长史" template, because this gallery is an anniversary album.
  subject: {
    name: {
      zh: '科技创新实验室', en: 'Sci-Tech Innovation Lab',
    },
    title: {
      zh: '科技创新实验室 · 20周年纪念',
      en: 'Sci-Tech Innovation Lab · 20th Anniversary',
    },
  },
  ga4MeasurementId: buildConfig.gaMeasurementId,
  domain: buildConfig.domain,
  htmlTitle: buildConfig.htmlTitle,
  donate: {
    enabled: false,
    paypalUrl: '',
    buyMeACoffeeUrl: '',
    alipayQr: '',
    wechatQr: '',
  },
  dock: {
    enabled: false,
    utm: { medium: 'referral', campaign: 'cross-promo', content: 'footer-dock' },
    projects: [],
  },
}

// Build a project's final href, appending the shared UTM query when opted in.
export const buildProjectHref = (project: DockProjectConfig, cfg: SiteConfig = siteConfig): string => {
  if (!project.utm) return project.href
  const { medium, campaign, content } = cfg.dock.utm
  const q = `utm_source=${cfg.domain}&utm_medium=${medium}&utm_campaign=${campaign}&utm_content=${content}`
  return `${project.href}?${q}`
}
