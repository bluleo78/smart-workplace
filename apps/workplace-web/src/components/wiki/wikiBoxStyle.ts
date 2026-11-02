// 노트 「상자 꾸미기」(WP-1304) — 상자(wikiHtmlBox) 노드의 style 글자를 꾸미기 창의 항목(모양·배경·글자색·테두리·모서리·여백·그림자)으로
// 읽고, 항목 하나를 바꾼 새 style 글자를 만든다. 편집기·React 와 무관한 순수 함수 모음이다.
//
// 왜 class 가 아니라 style 묶음인가: 저장되는 것은 상자 노드의 style 속성(sanitizeInlineStyle 통과) 하나뿐이라, 편집기·판 미리보기·공개 공유·
// 내보낸 HTML 이 모두 같은 글자로 같은 모양을 그린다. 색은 테마 변수(--wiki-box-*)에 밝은 기본값을 붙여 쓴다 —
// 앱 화면(wiki-editor.css 가 밝은·어두운 값을 정의)에서는 테마를 따라가고, 변수가 없는 화면(내보낸 HTML)은 밝은 기본값으로 보인다.
import { sanitizeInlineStyle, splitTopLevel } from '@smart-workplace/wiki-editor-schema'

import { BOX_BASIC_STYLE } from './wikiBox'

/** 미리 만든 모양 — 기본·안내·주의·강조. */
export type BoxPreset = 'basic' | 'info' | 'warning' | 'strong'
export type BoxBorder = 'none' | 'thin' | 'thick'
export type BoxRadius = 'square' | 'round'
export type BoxPadding = 'narrow' | 'normal' | 'wide'
export type BoxShadow = 'none' | 'has'

/** 꾸미기 창이 보여 줄 지금 값 — 배경·글자색은 저장된 값 글자(없으면 null), 여백은 세 단계 밖이면 null(아무것도 고르지 않은 상태). */
export interface BoxStyleFields {
  preset: BoxPreset | null
  background: string | null
  color: string | null
  border: BoxBorder
  radius: BoxRadius
  padding: BoxPadding | null
  shadow: BoxShadow
}

/** 항목 하나 바꾸기 — 꾸미기 창의 단추 한 번이 이 하나를 만든다(거래 하나 → 실행 취소 한 번). */
export type BoxStyleChange =
  | { field: 'preset'; value: BoxPreset }
  | { field: 'background'; value: string | null }
  | { field: 'color'; value: string | null }
  | { field: 'border'; value: BoxBorder }
  | { field: 'radius'; value: BoxRadius }
  | { field: 'padding'; value: BoxPadding }
  | { field: 'shadow'; value: BoxShadow }

/** 색 이름 → 테마 변수 + 밝은 기본값. 변수 값(밝은·어두운 — 대부분 index.css 디자인 토큰 별칭)은 wiki-editor.css 의 :root·.dark 에 있다. */
const tone = (name: string, light: string) => `var(--wiki-box-${name}, ${light})`

/** 기본 테두리 색 — 「기본」 모양(BOX_BASIC_STYLE)과 같은 앱 테두리 토큰. */
const DEFAULT_BORDER_COLOR = 'var(--border, #e5e7eb)'
const ROUND_RADIUS = '8px'
const SHADOW_VALUE = '0 2px 8px rgb(0 0 0 / 0.12)'
export const BOX_PADDINGS: Record<BoxPadding, string> = { narrow: '8px 12px', normal: '12px 16px', wide: '20px 24px' }

/** 배경 색 견본 — 「없음」은 배경 선언을 지운다. */
export const BOX_BACKGROUNDS: readonly { key: string; label: string; value: string | null }[] = [
  { key: 'none', label: '없음', value: null },
  { key: 'gray', label: '회색', value: tone('gray-bg', '#f3f4f6') },
  { key: 'blue', label: '파랑', value: tone('info-bg', '#eff6ff') },
  { key: 'yellow', label: '노랑', value: tone('warning-bg', '#fffbeb') },
  { key: 'green', label: '초록', value: tone('green-bg', '#ecfdf5') },
  { key: 'navy', label: '남색', value: tone('strong-bg', '#1e293b') },
]

/** 글자색 견본 — 「기본」은 글자색 선언을 지워 본문 글자색을 따른다. */
export const BOX_COLORS: readonly { key: string; label: string; value: string | null }[] = [
  { key: 'default', label: '기본', value: null },
  { key: 'blue', label: '파랑', value: tone('info-fg', '#1e40af') },
  { key: 'brown', label: '갈색', value: tone('warning-fg', '#92400e') },
  { key: 'white', label: '흰색', value: tone('strong-fg', '#ffffff') },
]

/** 미리 만든 모양 묶음 — style 글자 그대로 저장된다. 「기본」은 새 상자 모양(BOX_BASIC_STYLE)과 같은 글자다. */
export const BOX_PRESETS: readonly { key: BoxPreset; label: string; style: string }[] = [
  { key: 'basic', label: '기본', style: BOX_BASIC_STYLE },
  {
    key: 'info',
    label: '안내',
    style: `background: ${tone('info-bg', '#eff6ff')}; color: ${tone('info-fg', '#1e40af')}; border: 1px solid ${tone('info-border', '#bfdbfe')}; border-radius: 8px; padding: 12px 16px`,
  },
  {
    key: 'warning',
    label: '주의',
    style: `background: ${tone('warning-bg', '#fffbeb')}; color: ${tone('warning-fg', '#92400e')}; border: 1px solid ${tone('warning-border', '#f59e0b')}; border-radius: 8px; padding: 12px 16px`,
  },
  {
    key: 'strong',
    label: '강조',
    style: `background: ${tone('strong-bg', '#1e293b')}; color: ${tone('strong-fg', '#ffffff')}; border-radius: 8px; padding: 12px 16px`,
  },
]

/** 꾸미기가 다루는 속성 — 미리 만든 모양을 고르면 이것들만 바꾸고 나머지(들여온 카드의 display·margin 등)는 남긴다. */
const MANAGED = new Set([
  'background',
  'background-color',
  'color',
  'border',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'padding',
  'box-shadow',
])

/** 선언 하나 — prop 은 소문자, raw 는 원래 글자(바꾸지 않은 선언은 그대로 다시 쓴다). */
interface Decl {
  prop: string
  value: string
  raw: string
}

/** style 글자 → 선언 목록(빈 조각은 버린다). 공백 묶음은 정리기처럼 한 칸으로 본다. */
function parseDecls(style: string | null | undefined): Decl[] {
  if (!style) return []
  return splitTopLevel(style.replace(/\s+/g, ' '), ';')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const colon = raw.indexOf(':')
      return colon < 0
        ? { prop: '', value: raw, raw }
        : { prop: raw.slice(0, colon).trim().toLowerCase(), value: raw.slice(colon + 1).trim(), raw }
    })
}

const declsToStyle = (decls: Decl[]) => decls.map((d) => d.raw).join('; ')
const decl = (prop: string, value: string): Decl => ({ prop, value, raw: `${prop}: ${value}` })

/** 값 비교용 정규형 — 소문자·공백 한 칸·쉼표 뒤 공백 통일. 견본·묶음이 어느 글자로 저장됐든 같은 값이면 같게 본다. */
export function normalizeValue(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()
}

/** 속성의 마지막 선언 값(나중 선언이 이긴다) — 없으면 null. */
function lastValue(decls: Decl[], ...props: string[]): string | null {
  for (let i = decls.length - 1; i >= 0; i--) if (props.includes(decls[i].prop)) return decls[i].value
  return null
}

const BORDER_STYLES = /^(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)$/

/** 테두리 상태 — 굵기·선 모양·색(정해지지 않았으면 null). */
interface BorderState {
  width: string | null
  line: string | null
  color: string | null
}

/** 테두리 shorthand 값을 굵기·선 모양·색 조각으로 나눈다. */
function borderParts(value: string): BorderState {
  const tokens = splitTopLevel(value.trim(), ' ').filter(Boolean)
  let width: string | null = null
  let line: string | null = null
  const color: string[] = []
  for (const t of tokens) {
    const lower = t.toLowerCase()
    if (BORDER_STYLES.test(lower)) line = lower
    else if (/^(thin|medium|thick)$/.test(lower) || /^-?\d*\.?\d+(px|em|rem|pt)?$/.test(lower)) width = lower
    else color.push(t)
  }
  return { width, line, color: color.length ? color.join(' ') : null }
}

/** 여러 값(위·오른쪽·아래·왼쪽)을 받는 가로 속성의 첫 값 — 꾸미기는 네 변을 하나로 다루므로 위 변을 대표로 본다. */
const firstToken = (value: string) => splitTopLevel(value.trim(), ' ').find(Boolean) ?? null

/**
 * 선언 순서대로 테두리 상태를 쌓는다 — shorthand(border)는 세 값을 모두 새로 정하고(빠진 값은 초기값), 뒤에 오는
 * 가로 속성(border-width·border-style·border-color)은 그 하나만 덮는다. 들여온 카드의 `border-width: 2px; border-style: solid` 도 읽히게.
 */
function borderState(decls: Decl[]): BorderState {
  let state: BorderState = { width: null, line: null, color: null }
  for (const d of decls) {
    if (d.prop === 'border') state = borderParts(d.value)
    else if (d.prop === 'border-width') state = { ...state, width: firstToken(d.value)?.toLowerCase() ?? null }
    else if (d.prop === 'border-style') state = { ...state, line: firstToken(d.value)?.toLowerCase() ?? null }
    else if (d.prop === 'border-color') state = { ...state, color: firstToken(d.value) }
  }
  return state
}

/** 테두리 굵기 판정 — 선 모양이 없거나 none/hidden·굵기 0 이면 없음, 2px 이상(thick·medium 포함)이면 굵게, 나머지는 얇게. */
function borderKind({ width, line }: BorderState): BoxBorder {
  if (!line || line === 'none' || line === 'hidden') return 'none'
  if (width === null || width === 'medium' || width === 'thick') return 'thick'
  if (width === 'thin') return 'thin'
  const n = parseFloat(width)
  if (!(n > 0)) return 'none'
  return n >= 2 ? 'thick' : 'thin'
}

/** 꾸미기가 다루는 선언만 정규형 "prop: value" 로 — 미리 만든 모양 판정에 쓴다(순서는 보지 않는다). */
function managedSignature(decls: Decl[]): string {
  return decls
    .filter((d) => MANAGED.has(d.prop))
    .map((d) => `${d.prop}: ${normalizeValue(d.value)}`)
    .sort()
    .join('; ')
}

const PRESET_SIGNATURES = BOX_PRESETS.map((p) => ({ key: p.key, sig: managedSignature(parseDecls(p.style)) }))

/** style 글자 → 꾸미기 창의 지금 값. 꾸미기 밖 선언(display 등)은 미리 만든 모양 판정에서 빼고 본다. */
export function parseBoxStyle(style: string | null | undefined): BoxStyleFields {
  const decls = parseDecls(style)
  const sig = managedSignature(decls)
  const radius = lastValue(decls, 'border-radius')
  const padding = normalizeValue(lastValue(decls, 'padding'))
  const shadow = lastValue(decls, 'box-shadow')
  return {
    preset: PRESET_SIGNATURES.find((p) => p.sig === sig)?.key ?? null,
    background: lastValue(decls, 'background', 'background-color'),
    color: lastValue(decls, 'color'),
    border: borderKind(borderState(decls)),
    radius: !radius || /^0(px|%|em|rem)?$/i.test(radius.trim()) ? 'square' : 'round',
    padding: (Object.keys(BOX_PADDINGS) as BoxPadding[]).find((k) => BOX_PADDINGS[k] === padding) ?? null,
    shadow: !shadow || normalizeValue(shadow) === 'none' ? 'none' : 'has',
  }
}

/**
 * props 선언을 모두 지우고, 첫 선언이 있던 자리(없으면 끝)에 next 를 넣는다 — 바꾼 항목이 제자리에 남고 다른 선언 순서는 그대로다.
 * next 가 비면 지우기만 한다.
 */
function replaceDecls(decls: Decl[], props: readonly string[], next: Decl[]): Decl[] {
  const first = decls.findIndex((d) => props.includes(d.prop))
  const kept = decls.filter((d) => !props.includes(d.prop))
  const at = first < 0 ? kept.length : decls.slice(0, first).filter((d) => !props.includes(d.prop)).length
  return [...kept.slice(0, at), ...next, ...kept.slice(at)]
}

const BORDER_PROPS = ['border', 'border-width', 'border-style', 'border-color'] as const

/** 테두리 굵기 바꾸기 — 지금 테두리의 색·선 모양은 살리고(없으면 기본 테두리 색·실선) 굵기만 1px/2px 로. 없음이면 테두리 선언을 지운다. */
function borderDecls(decls: Decl[], kind: BoxBorder): Decl[] {
  if (kind === 'none') return []
  const parts = borderState(decls)
  const line = parts.line && parts.line !== 'none' && parts.line !== 'hidden' ? parts.line : 'solid'
  const color = parts.color ?? DEFAULT_BORDER_COLOR
  return [decl('border', `${kind === 'thick' ? '2px' : '1px'} ${line} ${color}`)]
}

/**
 * 항목 하나를 바꾼 새 style 글자 — 꾸미기 밖 선언은 그대로 남긴다. 정리기는 거치지 않는다 — 저장하는 한곳(wikiBox writeSelectedBoxStyle)이
 * 정리하고 비면 자리 지킴 선언을 둔다.
 */
export function applyBoxStyle(style: string | null | undefined, change: BoxStyleChange): string {
  const decls = parseDecls(style)
  let next: Decl[]
  switch (change.field) {
    case 'preset': {
      const preset = BOX_PRESETS.find((p) => p.key === change.value)!
      next = replaceDecls(decls, [...MANAGED], parseDecls(preset.style))
      break
    }
    case 'background':
      next = replaceDecls(decls, ['background', 'background-color'], change.value ? [decl('background', change.value)] : [])
      break
    case 'color':
      next = replaceDecls(decls, ['color'], change.value ? [decl('color', change.value)] : [])
      break
    case 'border':
      next = replaceDecls(decls, BORDER_PROPS, borderDecls(decls, change.value))
      break
    case 'radius':
      next = replaceDecls(decls, ['border-radius'], change.value === 'round' ? [decl('border-radius', ROUND_RADIUS)] : [])
      break
    case 'padding':
      next = replaceDecls(decls, ['padding'], [decl('padding', BOX_PADDINGS[change.value])])
      break
    case 'shadow':
      next = replaceDecls(decls, ['box-shadow'], change.value === 'has' ? [decl('box-shadow', SHADOW_VALUE)] : [])
      break
  }
  return declsToStyle(next)
}

/** 「CSS 로 직접 고치기」 칸에 채울 글자 — 선언 하나에 한 줄. */
export function styleToEditableText(style: string | null | undefined): string {
  return parseDecls(style)
    .map((d) => `${d.raw};`)
    .join('\n')
}

/**
 * 「CSS 로 직접 고치기」 적용 때 정리기가 뺄 선언 수(안내 문구용) — 저장은 writeSelectedBoxStyle 이 하고, 여기서는 세기만 한다.
 * 선언 단위는 정리기와 같은 자르기(parseDecls — 공용 splitTopLevel)로 센다.
 */
export function removedDeclCount(text: string): number {
  return Math.max(0, parseDecls(text).length - parseDecls(sanitizeInlineStyle(text)).length)
}

/** 정리기가 뺀 것이 있을 때 보여 줄 안내 — 오타도 빠지므로 「안전하지 않은」이 아니라 「쓸 수 없는」이라 한다. */
export function removedNote(removed: number): string | null {
  return removed > 0 ? `쓸 수 없는 값 ${removed}개를 뺐습니다` : null
}

/** style 글자 → React style 객체 — 꾸미기 창의 견본·모양 칸이 저장될 글자 그대로 그려지게(사용자 정의 속성 --x 는 이름 그대로). */
export function styleToReact(style: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of parseDecls(sanitizeInlineStyle(style))) {
    if (!d.prop) continue
    const key = d.prop.startsWith('--') ? d.prop : d.prop.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())
    out[key] = d.value
  }
  return out
}
