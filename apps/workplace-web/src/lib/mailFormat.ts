/**
 * 메일 작성기 서식 값 목록과 인라인 style 정규화.
 *
 * 왜 인라인 16진·px 인가: 받는 쪽 메일 프로그램은 이 앱의 CSS 변수·class 를 모른다.
 * 그래서 서식은 모두 `style="..."` 속성에 16진 색·px 크기 같은 자기완결 값으로 싣는다.
 *
 * 왜 허용 목록 정규화인가: 붙여넣기(외부 문서·다른 메일)로 들어온 임의의 글꼴·색·크기를 그대로 두면
 * 작성기 서식이 오염된다. 또 저장된 HTML 을 다시 파싱할 때 `rgb(...)`·짧은 16진·따옴표 차이를
 * 같은 값으로 맞춰야 도구 막대 상태가 일치한다. 아래 matchXxx·parseXxx 함수는 정해 둔 값만 돌려주고 나머지는 버린다.
 */
import { FORMAT_COLORS, type FormatColor } from '@/components/wiki/wikiTextFormat'
import { parseCssColor } from '@/lib/cssColor'

export type MailFontKey = 'default' | 'malgun' | 'gulim' | 'dotum' | 'batang' | 'arial' | 'times' | 'courier'

export interface MailFont {
  key: MailFontKey
  label: string
  /** font-family 값. null 이면 글꼴 지정 없음(기본). */
  css: string | null
}

/** 글꼴 목록(메뉴 순서). */
export const MAIL_FONTS: readonly MailFont[] = [
  { key: 'default', label: '기본', css: null },
  { key: 'malgun', label: '맑은 고딕', css: "'Malgun Gothic', '맑은 고딕', sans-serif" },
  { key: 'gulim', label: '굴림', css: "Gulim, '굴림', sans-serif" },
  { key: 'dotum', label: '돋움', css: "Dotum, '돋움', sans-serif" },
  { key: 'batang', label: '바탕', css: "Batang, '바탕', serif" },
  { key: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { key: 'times', label: 'Times New Roman', css: "'Times New Roman', Times, serif" },
  { key: 'courier', label: 'Courier New', css: "'Courier New', Courier, monospace" },
]

export type MailFontSizeKey = 'small' | 'normal' | 'large' | 'huge'

/** 글자 크기 목록. px 가 null 이면 크기 지정 없음(보통). */
export const MAIL_FONT_SIZES: readonly { key: MailFontSizeKey; label: string; px: number | null }[] = [
  { key: 'small', label: '작게', px: 12 },
  { key: 'normal', label: '보통', px: null },
  { key: 'large', label: '크게', px: 18 },
  { key: 'huge', label: '아주 크게', px: 24 },
]

/** 글자색·배경색 팔레트 — 노트와 같은 7색(「기본」은 UI 가 앞에 따로 그린다). */
export const MAIL_COLORS: readonly FormatColor[] = FORMAT_COLORS

export type MailAlign = 'left' | 'center' | 'right' | 'justify'

export const MAIL_ALIGNS: readonly { value: MailAlign; label: string }[] = [
  { value: 'left', label: '왼쪽' },
  { value: 'center', label: '가운데' },
  { value: 'right', label: '오른쪽' },
  { value: 'justify', label: '양쪽' },
]

export const MAIL_LINE_HEIGHTS = ['1.0', '1.15', '1.5', '2.0'] as const
export type MailLineHeight = (typeof MAIL_LINE_HEIGHTS)[number]

/** 들여쓰기 한 단계(px)와 최대 단계. */
export const MAIL_INDENT_STEP_PX = 40
export const MAIL_INDENT_MAX = 7

/** 표 인라인 style — 받는 쪽에서도 테두리가 보이도록 표·셀에 직접 싣는다. */
export const MAIL_TABLE_STYLE = 'border-collapse: collapse; border: 1px solid #d1d5db'
export const MAIL_CELL_STYLE = 'border: 1px solid #d1d5db; padding: 6px 10px; vertical-align: top; min-width: 48px'
export const MAIL_HEADER_CELL_STYLE = `${MAIL_CELL_STYLE}; background-color: #f3f4f6; font-weight: bold; text-align: left`

/** 서식 줄 펼침 여부를 기억하는 localStorage 키. */
export const MAIL_FORMAT_ROW_KEY = 'mail.composer.formatRowOpen'

/** 글꼴 이름 비교용 정규화 — 따옴표 제거·앞뒤 공백 제거·소문자. */
function normName(s: string): string {
  return s.replace(/["']/g, '').trim().toLowerCase()
}

/** font-family 값의 첫 글꼴 이름. */
function firstFamily(css: string): string {
  return normName(css.split(',')[0] ?? '')
}

/** 한글 별칭 — css 목록의 두 번째 이름(예: '맑은 고딕'). */
function koreanAlias(css: string): string | null {
  const second = css.split(',')[1]
  return second ? normName(second) : null
}

/** 붙여 넣은 font-family 의 첫 이름이 목록 글꼴(영문명 또는 한글 별칭)과 같으면 그 항목, 아니면 null. */
export function matchMailFont(raw: string | null | undefined): MailFont | null {
  if (!raw) return null
  const name = firstFamily(raw)
  if (!name) return null
  for (const f of MAIL_FONTS) {
    if (!f.css) continue
    if (firstFamily(f.css) === name || koreanAlias(f.css) === name) return f
  }
  return null
}

/** font-size 가 12/18/24px 일 때만 해당 키. 공백·대소문자는 무시한다. */
export function matchMailFontSize(raw: string | null | undefined): MailFontSizeKey | null {
  if (!raw) return null
  const m = /^(\d+(?:\.\d+)?)px$/.exec(raw.replace(/\s+/g, '').toLowerCase())
  if (!m) return null
  const px = Number(m[1])
  return MAIL_FONT_SIZES.find((s) => s.px === px)?.key ?? null
}

/** CSS 색(16진·rgb()·이름 색 등, lib/cssColor 가 읽는 표기)을 `#rrggbb` 소문자로. 못 읽거나 반투명이면 null. */
function normalizeHex(raw: string): string | null {
  const c = parseCssColor(raw)
  if (!c || c.a !== 1) return null
  return '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')
}

/** 색 값을 16진 소문자로 바꿔, 그 prop 의 팔레트(글자색=text, 배경색=mark)에 있을 때만 돌려준다. */
export function toMailColorHex(raw: string | null | undefined, prop: 'color' | 'background-color'): string | null {
  if (!raw) return null
  const hex = normalizeHex(raw)
  if (!hex) return null
  const field = prop === 'color' ? 'text' : 'mark'
  return MAIL_COLORS.some((c) => c[field] === hex) ? hex : null
}

/**
 * 단위 없는 line-height 숫자가 1/1.15/1.5/2 이면 해당 문자열.
 * 단위가 붙은 값(`2px`·`1pt`·`150%`)은 배수가 아니므로 버린다 — parseFloat 만 보면 `2px` 가 줄 간격 2배로 바뀐다.
 */
export function matchLineHeight(raw: string | null | undefined): MailLineHeight | null {
  if (!raw) return null
  const v = raw.trim()
  if (!/^\d+(?:\.\d+)?$/.test(v)) return null
  const n = parseFloat(v)
  return MAIL_LINE_HEIGHTS.find((h) => parseFloat(h) === n) ?? null
}

/** margin-left px 를 들여쓰기 단계(0~7)로. 못 읽으면 0. */
export function parseIndentStep(raw: string | null | undefined): number {
  if (!raw) return 0
  const m = /^\s*(-?\d+(?:\.\d+)?)px\s*$/i.exec(raw)
  if (!m) return 0
  const step = Math.round(Number(m[1]) / MAIL_INDENT_STEP_PX)
  return Math.min(MAIL_INDENT_MAX, Math.max(0, step))
}
