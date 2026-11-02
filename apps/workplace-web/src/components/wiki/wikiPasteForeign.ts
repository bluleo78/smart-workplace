import { FORMAT_PROPS, type FormatProp, parseDeclarations, splitTopLevel, WIKI_HTML_SPAN } from '@smart-workplace/wiki-editor-schema'
import type { Mark, Node as PMNode, Slice } from '@tiptap/pm/model'

import { parseCssColor, relativeLuminance, type Rgba } from '@/lib/cssColor'

import { borderKind, borderParts, type BorderState } from './wikiBoxStyle'
import { type BoxDecision, hasShape, normalizeShapeSlice, type ShapePolicy } from './wikiShapeNormalize'
import { hasUnderline } from './wikiTextFormat'

/**
 * 노트 밖에서 온 HTML 붙여넣기의 「모양 유지」 정리기(WP-1306) — 웹 페이지에서 끌어 복사한 카드·색 배경·색 글자를 노트의 상자·글 서식으로 남기고,
 * Google Docs·Word·웹 페이지가 실어 보내는 글꼴·크기·여백 같은 군더더기는 걸러 「글만」 결과와 크게 다르지 않게 한다. 편집기와 무관한 순수 함수다.
 *
 * 왜 이렇게 거르는가:
 * - 브라우저는 복사할 때 페이지 CSS 규칙으로 정해진 모양을 각 요소의 인라인 style 로 옮겨 싣는다(Chrome 의 interchange 직렬화). 그래서
 *   페이지의 전역 `<style>`·class 이름 없이도 클립보드의 인라인 style 만으로 카드 배경·테두리·글자색이 온다. 이 앱에는 그 페이지 CSS 가 없으니
 *   class 는 뜻이 없고, 노트 페이지 스타일의 같은 이름 class(.card 등)에 우연히 걸릴 수 있어 모두 뗀다. 전역 `<style>`(wikiStyle)도 버린다.
 * - 인라인 style 은 허용 목록으로 거른다 — 상자는 꾸미기 창(WP-1304)이 다루는 모양(배경·글자색·테두리·모서리·여백·그림자), 글은 서식 도구(WP-1305)가
 *   다루는 밑줄·글자색·배경색만. 글꼴(font-family)·크기(font-size)·줄 높이·여백(margin)·너비·display·mso-* 등 나머지는 모두 버린다.
 *   결과가 class 없는 서식 span·상자라 노트의 다른 서식과 똑같이 서식 도구·꾸미기 창으로 고칠 수 있다.
 * - 무채색(검정·회색·흰색) 글자색·글 배경색은 원래 페이지 테마의 기본값이라 버린다 — Google Docs 의 color:#000000, 웹 페이지의 본문 글자색이
 *   남으면 어두운 테마에서 글이 보이지 않는다. 다만 배경을 지닌 상자 안(또는 배경을 지닌 글)에서는 그 배경에 맞춘 글자색이라 남긴다.
 * - 배경·테두리·그림자가 하나도 없는 컨테이너(여백·글자색뿐인 div)는 눈에 보이는 상자가 아니라서 풀고, 그 유채색 글자색만 안 글자로 내린다.
 */

/** 색 하나 — 공용 색 파서(lib/cssColor)의 0~255 채널과 0~1 알파. */
export type CssColor = Rgba

/**
 * 무채색으로 볼 채도 상한 — 채널 최댓값·최솟값 차이(0~255). 40 이면 slate·gray·zinc 계열 본문 글자색(#334155 의 차이 34·#0f172a 의 27)은
 * 무채색, 흐린 브랜드 색(차이 60 이상)부터 유채색이다.
 */
const NEUTRAL_CHROMA_MAX = 40

/**
 * 아주 밝은 색(밝기 0.85 이상)의 무채색 상한 — 흰색 언저리는 차이가 작아도 눈에 색이 보인다(형광펜·배지의 옅은 초록 #dcfce7 은 차이 32,
 * 옅은 빨강 #fee2e2 은 28). 회색 바탕(#e2e8f0 차이 14·#f3f4f6 차이 3)만 무채색으로 남게 20 으로 둔다.
 */
const NEUTRAL_CHROMA_MAX_LIGHT = 20
const LIGHT_TINT_MIN = 0.85

/** 페이지 흰 바탕으로 볼 밝기 하한 — 세 채널이 모두 이 값 이상인 무채색 배경(#f8f8f8 이상)은 상자 배경으로 남기지 않는다. */
const PAGE_WHITE_MIN = 248

/**
 * 밝은 배경으로 볼 WCAG 상대 휘도 하한 — 검정 글자와 흰 글자의 대비가 같아지는 지점(≈0.179). 이 이상이면 어두운 글자가, 미만이면 밝은 글자가
 * 더 잘 읽힌다. 상자 배경에 맞출 글자색을 고를 때 쓴다.
 */
const LIGHT_BACKGROUND_LUMINANCE = 0.179

/**
 * 색으로 쓰이지만 실제 색이 아닌 값 — 투명·상속·초기값·시스템 색(Word 의 windowtext 등). 이 앱에서 뜻이 없어 버린다.
 * transparent 는 공용 파서가 읽지 않으므로(메일 변환은 투명을 따로 다루지 않는다) 여기서 버린다.
 */
const NON_COLOR_KEYWORDS = new Set([
  'transparent',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'currentcolor',
  'auto',
  'none',
  'windowtext',
  'window',
  'canvas',
  'canvastext',
  'buttontext',
  'buttonface',
])

/** 무채색인지 — 채널 차이가 작다(검정·회색·흰색과 그 언저리). */
export function isNeutralColor(c: CssColor): boolean {
  const max = Math.max(c.r, c.g, c.b)
  const min = Math.min(c.r, c.g, c.b)
  const lightness = (max + min) / 2 / 255
  return max - min <= (lightness >= LIGHT_TINT_MIN ? NEUTRAL_CHROMA_MAX_LIGHT : NEUTRAL_CHROMA_MAX)
}

/** 이 앱에서 풀 수 없는 값 — 바깥 페이지의 CSS 변수(var)·url 이미지·image-set·expression 류. */
const UNRESOLVABLE = /var\(|url\(|image-set\(|expression\(/i

/**
 * 선언 값 하나를 한 번에 손질한다 — 끝의 !important 를 떼고(노트 서식은 덮어쓰기 우선순위를 쓰지 않는다), 비었거나 이 앱에서 풀 수 없으면 null.
 * 아래 판정 함수들은 이 손질을 거친 값만 받는다.
 */
function cleanValue(raw: string): string | null {
  const value = raw.replace(/\s*!important\s*$/i, '').trim()
  return value && !UNRESOLVABLE.test(value) ? value : null
}

/** 읽은 색 값 — 남길 원래 글자와, 색으로 읽히면 그 색(모르는 표기는 null 로 두고 유채색처럼 남긴다). */
interface ColorValue {
  value: string
  color: CssColor | null
}

/** 색 선언 값(손질한 값) 판정 — 버릴 값(색 아닌 낱말·여러 낱말·투명)이면 null. */
function colorValue(value: string): ColorValue | null {
  if (NON_COLOR_KEYWORDS.has(value.toLowerCase()) || /\s/.test(value.replace(/\([^)]*\)/g, ''))) return null
  const color = parseCssColor(value)
  if (color && color.a === 0) return null
  return { value, color }
}

/** 배경 판정 결과 — 그라디언트는 background 로(밝기 모름), 색은 background-color 로. */
interface BackgroundValue extends ColorValue {
  prop: 'background' | 'background-color'
}

/**
 * background 단축 선언(손질한 값)에서 배경을 꺼낸다 — 그라디언트면 그대로, 색 토큰이 있으면 그 색만. 투명이거나 색이 없으면 null.
 * Chrome 은 `background: rgb(…) none repeat scroll 0% 0% / auto padding-box border-box` 처럼 계산값을 다 싣는다.
 */
function backgroundValue(value: string): BackgroundValue | null {
  if (/gradient\(/i.test(value)) return { prop: 'background', value, color: null }
  for (const token of splitTopLevel(value, ' ')) {
    const t = token.trim()
    if (!t) continue
    if (t.toLowerCase() === 'transparent') return null
    const parsed = parseCssColor(t)
    if (parsed) return parsed.a === 0 ? null : { prop: 'background-color', value: t, color: parsed }
  }
  return null
}

/** background·background-color 선언(손질한 값) → 배경. */
function backgroundDecl(prop: string, value: string): BackgroundValue | null {
  if (prop === 'background') return backgroundValue(value)
  const c = colorValue(value)
  return c && { prop: 'background-color', ...c }
}

/**
 * 테두리 선(단축 선언 하나 또는 쌓은 상태)이 보이는지 — 꾸미기 창의 테두리 판정(borderKind: 선 모양 없음·none/hidden·굵기 0 이면 없음)에
 * 투명 색을 더 본다(붙여넣은 `border: 1px solid transparent` 는 자리만 잡는 선이다).
 */
const borderLineVisible = (b: BorderState) => borderKind(b) !== 'none' && b.color?.toLowerCase() !== 'transparent'

/** 굵기 0 토큰(0·0px·0.0em). */
const ZERO_WIDTH = /^0(\.0+)?([a-z]+)?$/i

/**
 * 상자에 남기는 속성 — 꾸미기 창(WP-1304, wikiBoxStyle 의 MANAGED)이 다루는 모양의 상위 집합이다. 꾸미기 창은 네 변을 하나로 다루지만,
 * 웹 카드의 한 변 테두리(border-left 강조선)·모서리별 둥글기·변별 여백도 같은 모양이라 남긴다(꾸미기 창에서는 「직접 고치기」로 고친다).
 * 배경·글자색은 따로 판정한다.
 */
const BOX_KEEP_PROPS = new Set([
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'box-shadow',
])

/** 테두리 단축 선언 — 보이는 선인지 따로 본다. */
const BORDER_SHORTHANDS = new Set(['border', 'border-top', 'border-right', 'border-bottom', 'border-left'])

/** 상자 style 정리 결과. visible — 배경·보이는 테두리·그림자 중 하나라도 있어 상자로 남길지. */
export interface ForeignBoxStyle {
  style: string | null
  visible: boolean
  /** 배경을 남겼는지 — 안 글자의 무채색 글자색을 남길지 정한다. */
  hasBackground: boolean
  /** 상자가 상자로 남지 않을 때 안 글자로 내릴 글자색(유채색이거나 배경 상자 안이면 무채색도). */
  color: string | null
}

/**
 * 바깥 상자(wikiHtmlBox) style 을 거른다 — 허용 속성만, 배경은 페이지 흰 바탕·투명을 빼고, 배경을 남긴 상자에 글자색이 없으면
 * 배경 밝기에 맞춘 글자색을 더한다(밝은 카드가 어두운 테마의 밝은 본문 글자와 겹쳐 안 보이지 않게). insideBackground — 바깥 상자에 배경이 있는지.
 */
export function filterForeignBoxStyle(style: unknown, insideBackground = false): ForeignBoxStyle {
  const kept: [string, string][] = []
  let background: BackgroundValue | null = null
  let color: ColorValue | null = null
  // 테두리 — 보이는 단축 선언이 있거나, 가로 속성(border-style)으로 선 모양을 정했고 굵기를 모두 0 으로 두지 않았으면 보인다.
  // 가로 속성은 네 변 값을 다 본다(border-width: 0 0 2px 처럼 아래 변만 그은 카드) — 꾸미기 창의 borderState 는 위 변만 대표로 읽어 여기 쓰지 않는다.
  let borderVisible = false
  let borderStyleVisible = false
  let borderZeroWidth = false
  let shadow = false
  for (const [prop, raw] of parseDeclarations(style)) {
    const value = cleanValue(raw)
    if (!value) continue
    if (prop === 'background' || prop === 'background-color') {
      const bg = backgroundDecl(prop, value)
      // 페이지 흰 바탕(무채색으로 아주 밝음)은 카드 배경이 아니라 바깥 페이지 바탕이다.
      const pageWhite = !!bg?.color && isNeutralColor(bg.color) && Math.min(bg.color.r, bg.color.g, bg.color.b) >= PAGE_WHITE_MIN
      background = pageWhite ? null : bg
      continue
    }
    if (prop === 'color') {
      color = colorValue(value)
      continue
    }
    if (!BOX_KEEP_PROPS.has(prop)) continue
    if (BORDER_SHORTHANDS.has(prop)) {
      // 안 보이는 단축 선언(border: 0 none)은 남기지 않는다.
      if (!borderLineVisible(borderParts(value))) continue
      borderVisible = true
    } else if (prop === 'border-style') {
      if (!/^(none|hidden)$/i.test(value)) borderStyleVisible = true
    } else if (prop === 'border-width') {
      if (value.split(/\s+/).every((t) => ZERO_WIDTH.test(t))) borderZeroWidth = true
    } else if (prop === 'box-shadow') {
      if (/^none$/i.test(value)) continue
      shadow = true
    }
    kept.push([prop, value])
  }
  const hasBackground = !!background
  const borderShown = borderVisible || (borderStyleVisible && !borderZeroWidth)
  const visible = hasBackground || shadow || borderShown
  // 무채색 글자색은 배경(이 상자나 바깥 상자)에 맞춘 것일 때만 남긴다.
  const colorKept = color && (!color.color || !isNeutralColor(color.color) || hasBackground || insideBackground) ? color.value : null
  if (!visible) return { style: null, visible: false, hasBackground: false, color: colorKept }
  const decls: [string, string][] = []
  if (background) decls.push([background.prop, background.value])
  if (colorKept) decls.push(['color', colorKept])
  else if (background?.color && !insideBackground) {
    const { r, g, b } = background.color
    decls.push(['color', relativeLuminance(r, g, b) >= LIGHT_BACKGROUND_LUMINANCE ? '#111827' : '#f9fafb'])
  }
  // 테두리가 안 보이면(폭 0 등) 테두리 선언은 남기지 않는다 — 꾸미기 창이 「테두리 없음」으로 읽게. 둥글기는 테두리와 무관하게 남긴다.
  for (const [p, v] of kept) if (borderShown || !p.startsWith('border') || p.endsWith('radius')) decls.push([p, v])
  return { style: decls.map(([p, v]) => `${p}: ${v}`).join('; '), visible: true, hasBackground, color: colorKept }
}

/**
 * 글에 겹친 인라인 모양 선언(바깥 → 안 순서, 뒤가 이긴다)을 서식 span 하나의 style 로 — 밑줄·글자색·배경색만 남긴다(WP-1305 서식 span 과 같은 꼴).
 * 무채색 배경색은 페이지 바탕이라 버리고, 무채색 글자색은 배경(바깥 상자나 이 글 자신)이 있을 때만 남긴다. 남는 게 없으면 null.
 */
export function filterForeignSpanStyle(declsInOrder: readonly [string, string][], insideBackground = false): string | null {
  let underline = false
  let color: ColorValue | null = null
  let background: ColorValue | null = null
  for (const [prop, raw] of declsInOrder) {
    // 풀 수 없는 값도 그 속성을 덮는다(뒤 선언이 이긴다) — 그래서 건너뛰지 않고 null 로 둔다.
    const value = cleanValue(raw)
    if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      // line-through 는 취소선 마크(StarterKit)가 이미 읽었다 — 밑줄만 서식 span 이 맡는다.
      underline = hasUnderline(value)
    } else if (prop === 'color') {
      color = value ? colorValue(value) : null
    } else if (prop === 'background' || prop === 'background-color') {
      const bg = value ? backgroundDecl(prop, value) : null
      // 그라디언트 글 배경은 서식 도구가 다루지 않고, 무채색 배경색은 페이지 바탕이라 버린다.
      background = bg && bg.prop === 'background-color' && !(bg.color && isNeutralColor(bg.color)) ? bg : null
    }
  }
  // 서식 span 의 속성(FORMAT_PROPS) 순서대로 쓴다 — 서식 도구가 만든 span 과 같은 글자가 되게.
  const out: Partial<Record<FormatProp, string>> = {}
  if (underline) out['text-decoration'] = 'underline'
  if (color && (!color.color || !isNeutralColor(color.color) || insideBackground || background)) out.color = color.value
  if (background) out['background-color'] = background.value
  const decls = FORMAT_PROPS.filter((p) => out[p]).map((p) => `${p}: ${out[p]}`)
  return decls.length ? decls.join('; ') : null
}

/** 정리 중 물려주는 맥락 — 바깥 상자에 배경이 있는지, 풀린 컨테이너에서 내려온 글자색. */
interface ForeignContext {
  insideBackground: boolean
  color: string | null
}

/** 글 하나의 마크 — 인라인 모양 마크들을 서식 span 하나로 모으고(내려온 글자색 포함) 나머지 마크는 그대로. 글이 아닌 노드는 마크를 건드리지 않는다. */
function foreignMarks(node: PMNode, ctx: ForeignContext): readonly Mark[] {
  if (!node.isText) return node.marks
  const spans = node.marks.filter((m) => m.type.name === WIKI_HTML_SPAN)
  if (!spans.length && !ctx.color) return node.marks
  const decls: [string, string][] = ctx.color ? [['color', ctx.color]] : []
  for (const m of spans) decls.push(...parseDeclarations(m.attrs.style))
  const style = filterForeignSpanStyle(decls, ctx.insideBackground)
  const rest = node.marks.filter((m) => m.type.name !== WIKI_HTML_SPAN)
  if (!style) return rest
  return node.type.schema.marks[WIKI_HTML_SPAN].create({ className: null, style }).addToSet(rest)
}

/** 상자 판정 — 보이는 상자는 걸러 남기고(class 는 뗀다), 안 보이는 컨테이너는 풀어 그 글자색만 안 글자로 내린다. */
function foreignBox(node: PMNode, ctx: ForeignContext): BoxDecision<ForeignContext> {
  const box = filterForeignBoxStyle(node.attrs.style, ctx.insideBackground)
  if (!box.visible) return { keep: false, inner: { ...ctx, color: box.color ?? ctx.color } }
  return {
    keep: true,
    attrs: { ...node.attrs, className: null, style: box.style },
    // 상자에 글자색이 있으면 CSS 상속으로 안 글자에 간다 — 위에서 내려온 글자색은 더 내리지 않는다.
    inner: { insideBackground: ctx.insideBackground || box.hasBackground, color: box.color ? null : ctx.color },
  }
}

/** 「모양 유지」 정책 — 상자는 걸러 남기거나 풀고, 글의 인라인 모양은 서식 span 으로, 문단 정렬은 그대로. */
const FOREIGN_POLICY: ShapePolicy<ForeignContext> = { box: foreignBox, marks: foreignMarks, clearAlign: false }

/**
 * 노트 밖에서 온 HTML 조각을 「모양 유지」로 정리한다(순수 함수) — 머리 주석의 규칙. 문단·제목 정렬(WP-1305)은 그대로 둔다(저장 때
 * 정렬할 수 없는 자리의 정렬은 직렬화기가 버린다 — canAlignIn). 모양이 하나도 없으면 같은 조각을 그대로 돌려준다.
 */
export function foreignShapeSlice(slice: Slice): Slice {
  if (!hasShape(slice.content)) return slice
  return normalizeShapeSlice(slice, FOREIGN_POLICY, { insideBackground: false, color: null })
}

/**
 * DOM 손질이 필요한 HTML 인지 — `<u>`·`<font>`, 또는 글자색·밑줄 style 을 단 문단·제목·링크·굵게·기울임 요소. 그 밖의 붙여넣기(보통 글)는
 * DOMParser 를 한 번 더 돌리지 않고 그대로 넘긴다. (background-color 도 color 로 걸리지만 손질이 아무것도 바꾸지 않을 뿐이다.)
 */
const NEEDS_PREPARE = /<(?:u|font)\b|<(?:p|h[1-6]|a|b|strong|em|i)\b[^>]*\bstyle\s*=[^>]*(?:color|text-decoration)/i

/**
 * 붙여넣기 전 HTML 손질 — 파싱 규칙이 모양으로 읽지 못하는 서식을 읽히는 꼴로 바꾼다(DOM 을 고쳐 다시 글자로).
 * - `<u>`(Word·옛 편집기 밑줄) → 밑줄 span. 노트 밑줄은 서식 span(text-decoration)이라 `<u>` 는 그대로면 버려진다.
 * - `<font color>` → 글자색 span.
 * - 문단·제목·링크·굵게·기울임 요소에 붙은 글자색·밑줄 style → 안쪽을 그 style 의 span 으로 감싼다. 문단 노드는 style 을 담지 않아
 *   `<p style="color:…">` 의 색이 버려지기 때문이다(span 은 인라인 모양 마크로 읽힌다). 다른 선언은 정리기가 어차피 버리므로 옮기지 않는다.
 * 전역 `<style>`·`<link>`·`<script>` 는 ProseMirror 가 파싱 때 버린다(ignoreTags) — 여기서 따로 지우지 않는다.
 */
export function prepareForeignHtml(html: string): string {
  if (!NEEDS_PREPARE.test(html)) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  /** el 의 자식을 모두 옮겨 담은 style span — 부르는 쪽이 el 을 바꾸거나(replaceWith) el 안에 넣는다(appendChild). */
  const toSpan = (el: Element, style: string) => {
    const span = doc.createElement('span')
    span.setAttribute('style', style)
    while (el.firstChild) span.appendChild(el.firstChild)
    return span
  }
  doc.body.querySelectorAll('u').forEach((u) => u.replaceWith(toSpan(u, 'text-decoration: underline')))
  doc.body.querySelectorAll('font[color]').forEach((font) => font.replaceWith(toSpan(font, `color: ${font.getAttribute('color')}`)))
  doc.body.querySelectorAll('p[style],h1[style],h2[style],h3[style],h4[style],h5[style],h6[style],a[style],b[style],strong[style],em[style],i[style]').forEach((el) => {
    const moved = parseDeclarations(el.getAttribute('style'))
      .filter(([p]) => p === 'color' || p === 'text-decoration' || p === 'text-decoration-line')
      .map(([p, v]) => `${p}: ${v}`)
    if (moved.length) el.appendChild(toSpan(el, moved.join('; ')))
  })
  return doc.body.innerHTML
}
