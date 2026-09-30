// 다크 테마에서 HTML 메일 본문을 어둡게 보이게 하는 변환(WP-103).
// 본문은 sandbox iframe(srcDoc)이라 앱 테마 CSS 가 닿지 않고, 배경 지정이 없으면 브라우저 기본 흰색으로 그려진다.
// Outlook/OWA 메일은 모든 요소에 color:rgb(0,0,0) 을 박아두므로 배경만 바꾸면 글자가 안 보인다 →
// 흰 바탕 외의 배경 지정이 없는 메일에 한해 배경을 테마색으로 주입하고, 어두운 글자색(인라인·<style>)만 명도를 뒤집는다.
// 유색·이미지 배경이나 bgcolor 를 쓰는 뉴스레터형 메일은 레이아웃·브랜드 색이 흰 바탕을 전제하므로 원본 그대로 둔다.

/** iframe 안에 주입할 테마 색 — 앱 CSS 토큰(--background 등)의 계산값 */
interface MailThemeColors {
  background: string
  foreground: string
  link: string
}

/**
 * <style> 안의 background 계열 선언(`background`·`background-color`·`background-image` …)과 값(!important 제외).
 * 선언 경계(`{`·`;`·공백) 뒤만 잡으므로 `.headerBackgroundMsoTable` 같은 클래스 이름은 걸리지 않는다.
 */
const SHEET_BG_DECL = /(^|[\s;{])(background[\w-]*)(\s*:\s*)([^;}!]+)/gi
/** <style> 안의 글자색 선언과 값 — `border-color`·`background-color` 는 앞 글자가 `-` 라 걸리지 않는다 */
const SHEET_COLOR_DECL = /(^|[\s;{])(color\s*:\s*)([^;}!]+)/gi

/** 배경으로 봐도 흰 바탕과 다를 게 없는 값 — 붙여넣기·인용에서 생기는 `background-color:white` 등 */
const NEUTRAL_BG_KEYWORDS = new Set(['', 'transparent', 'none', 'initial', 'inherit', 'unset', 'white', 'window'])
/** 이 이상이면 거의 흰색(#f5f5f5 등)으로 본다 */
const NEAR_WHITE = 240

/** 명도 반전 대상 상한 — 이보다 밝은 색(강조 오렌지 등)은 다크 배경에서도 읽히므로 유지 */
const DARK_LIGHTNESS = 0.5
/** 순흑(L=0)이 반전됐을 때의 명도 — 앱 --foreground(oklch 0.93) 과 비슷하게 순백보다 살짝 낮춘다 */
const MAX_LIGHTNESS = 0.93

/** 자주 쓰이는 이름 색(어두운 색 + 흰색) — 나머지 이름 색은 해석하지 않고 둔다 */
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  navy: [0, 0, 128],
  darkblue: [0, 0, 139],
  maroon: [128, 0, 0],
  darkgreen: [0, 100, 0],
  windowtext: [0, 0, 0],
  white: [255, 255, 255],
}

type Rgba = { r: number; g: number; b: number; a: number }

/** CSS 색 문자열 → RGBA. rgb/rgba·#rgb·#rrggbb·일부 이름 색만 지원, 그 외는 null(원본 유지) */
export function parseCssColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase()
  const named = NAMED[v]
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v)
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4])
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: alpha }
  }
  return null
}

/**
 * 어두운 색이면 색상(hue)은 유지한 채 명도만 밝게 뒤집은 rgb 문자열을, 이미 밝은 색이거나 해석 불가면 null 을 돌려준다.
 * 명도 L∈[0, 0.5) 를 [0.93, 0.5] 로 선형 매핑 — 검정은 밝은 회백, 회색 계열은 비례해 밝아진다.
 */
export function lightenDarkColor(value: string): string | null {
  const c = parseCssColor(value)
  if (!c) return null
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b)
  if (l >= DARK_LIGHTNESS) return null
  const nl = MAX_LIGHTNESS - (l / DARK_LIGHTNESS) * (MAX_LIGHTNESS - DARK_LIGHTNESS)
  const [r, g, b] = hslToRgb(h, s, nl)
  return c.a < 1 ? `rgba(${r}, ${g}, ${b}, ${c.a})` : `rgb(${r}, ${g}, ${b})`
}

/** 흰색·거의 흰색·투명 등 '배경 없음'과 같게 볼 수 있는 배경색인지 */
export function isNeutralBackground(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (NEUTRAL_BG_KEYWORDS.has(v)) return true
  const c = parseCssColor(v)
  if (!c) return false
  return c.a === 0 || (c.r >= NEAR_WHITE && c.g >= NEAR_WHITE && c.b >= NEAR_WHITE)
}

/** 인라인 style 의 배경이 중립(흰색·투명·지정 없음)인지 — 배경 이미지가 있으면 중립이 아니다 */
function hasNeutralInlineBackground(el: HTMLElement): boolean {
  return isNeutralBackground(el.style.backgroundImage) && isNeutralBackground(el.style.backgroundColor)
}

/** <style> 블록의 배경 선언 값이 모두 중립색 한 단어(또는 none)인지 — `background:#fff url(...)` 같은 복합값·이미지는 중립이 아니다 */
function hasNeutralSheetBackground(css: string): boolean {
  return [...css.matchAll(SHEET_BG_DECL)].every((m) => isNeutralBackground(m[4]))
}

/**
 * 메일이 흰 바탕이 아닌 배경을 스스로 지정하는지 — 지정했다면 원본 그대로 보여준다.
 * 흰색·투명 배경(붙여넣기·인용·서명 div 에 흔함)은 배경 없음과 같게 보고 변환 때 투명으로 바꾼다.
 * bgcolor·background 속성은 표 기반 뉴스레터에서 주로 쓰여 흰색이어도 원본을 유지한다.
 */
export function hasOwnBackground(doc: Document): boolean {
  if (doc.querySelector('[bgcolor], [background]')) return true
  for (const el of doc.querySelectorAll<HTMLElement>('[style]')) {
    if (!hasNeutralInlineBackground(el)) return true
  }
  for (const style of doc.querySelectorAll('style')) {
    if (!hasNeutralSheetBackground(style.textContent ?? '')) return true
  }
  return false
}

/** <style> 텍스트의 배경을 투명으로, 어두운 글자색을 밝게 바꾼다 — 클래식 Outlook 의 `a:link{color:#0563C1}` 등 */
function darkenStyleSheet(css: string): string {
  return css
    // 여기까지 온 배경 선언은 모두 중립값 — 색 속성만 투명으로(background-image:none 등은 그대로)
    .replace(SHEET_BG_DECL, (m, pre: string, prop: string, sep: string) =>
      /^background(-color)?$/i.test(prop) ? `${pre}${prop}${sep}transparent` : m,
    )
    .replace(SHEET_COLOR_DECL, (m, pre: string, decl: string, value: string) => {
      const next = lightenDarkColor(value)
      return next ? `${pre}${decl}${next}` : m
    })
}

/**
 * 다크 테마용 메일 HTML 로 변환한다. 배경을 스스로 지정한 메일은 입력 문자열을 그대로 돌려준다.
 * DOMParser 재직렬화는 <!DOCTYPE> 를 떨어뜨려 표준/쿼크 모드(표 레이아웃)가 바뀌므로 원본 doctype 을 다시 붙인다.
 */
export function applyMailDarkMode(html: string, colors: MailThemeColors): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (hasOwnBackground(doc)) return html

  for (const el of doc.querySelectorAll<HTMLElement>('[style]')) {
    // 중립 배경(흰색 등)은 다크 바탕 위에 흰 조각으로 남지 않게 투명으로
    if (el.style.backgroundColor) el.style.backgroundColor = 'transparent'
    const next = el.style.color ? lightenDarkColor(el.style.color) : null
    if (next) el.style.color = next
  }
  for (const font of doc.querySelectorAll('font[color]')) {
    const next = lightenDarkColor(font.getAttribute('color') ?? '')
    if (next) font.setAttribute('color', next)
  }
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = darkenStyleSheet(style.textContent ?? '')
  }

  // 색 지정이 없는 글자·링크는 기본값(검정·#0000EE)이 되므로 테마색을 기본 규칙으로 깐다(메일 자체 규칙·인라인이 우선)
  const base = doc.createElement('style')
  base.textContent =
    `:root{color-scheme:dark}` +
    `html,body{background:${colors.background};color:${colors.foreground}}` +
    `a{color:${colors.link}}`
  doc.head.prepend(base)

  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : ''
  return doctype + doc.documentElement.outerHTML
}

/** RGB(0~255) → HSL(각 0~1) */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

/** HSL(각 0~1) → RGB(0~255 정수) */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)]
}
