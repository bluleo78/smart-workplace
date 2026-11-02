// 다크 테마에서 HTML 메일 본문을 어둡게 보이게 하는 변환(WP-103, WP-159).
// 본문은 sandbox iframe(srcDoc)이라 앱 테마 CSS 가 닿지 않고, 배경 지정이 없으면 브라우저 기본 흰색으로 그려진다.
// 메일을 "변환 / 원본" 으로 분류하면 형광펜 한 줄 같은 예외마다 규칙이 늘어나므로(WP-159), Outlook·Apple Mail 처럼
// 모든 메일에 같은 색 단위 규칙을 적용한다 — 밝은 배경은 색상(hue)을 유지한 채 어둡게, 어두운 글자는 밝게.
// 이미 어두운 배경·밝은 글자·이미지는 그대로 둔다. 변환이 어색한 메일은 화면의 "원본 배경으로 보기" 토글로 확인한다.

import { hslToRgb, parseCssColor, relativeLuminance, type Rgba, rgbToHsl } from './cssColor'

// 메일 테스트·다른 호출부가 이 모듈에서 읽던 색 파서를 그대로 쓸 수 있게 다시 내보낸다.
export { parseCssColor }

/** iframe 안에 주입할 테마 색 — 앱 CSS 토큰(--background 등)의 계산값 */
interface MailThemeColors {
  background: string
  foreground: string
  link: string
}

/**
 * <style> 안의 배경 선언(`background`·`background-color`·`background-image`)과 값(!important 제외).
 * 선언 경계(`{`·`;`·공백) 뒤만 잡으므로 `.headerBackgroundMsoTable` 같은 클래스 이름은 걸리지 않는다.
 */
const SHEET_BG_DECL = /(^|[\s;{])(background(?:-color|-image)?)(\s*:\s*)([^;}!]+)/gi
/** <style> 안의 글자색 선언과 값 — `border-color`·`background-color` 는 앞 글자가 `-` 라 걸리지 않는다 */
const SHEET_COLOR_DECL = /(^|[\s;{])(color\s*:\s*)([^;}!]+)/gi

/** 이 이상이면 거의 흰색(#f5f5f5 등)으로 보고 투명하게 — 앱 배경이 그대로 비치게 */
const NEAR_WHITE = 240
/**
 * 어둡게 바꾼 배경의 최대 휘도. 밝힌 글자(휘도 ≥ MIN_LUMINANCE)와 대비 3:1 이상, 순흑 글자 반전색(≈0.84)과는 10:1 이상이 되는 값 —
 * 노란 형광펜도 앱 배경(휘도 ≈0.008)과 구분되는 짙은 올리브 정도로 남는다.
 */
const MAX_BG_LUMINANCE = 0.03

/**
 * '어두운 글자색' 판정 기준(WCAG 상대 휘도). 다크 배경(휘도 ≈0.005)과의 대비가 4.5:1 이 되는 지점 —
 * 이보다 밝은 색(강조 오렌지 등)은 그대로 읽히므로 유지하고, 미만이면 이 휘도 이상이 될 때까지 밝힌다.
 * HSL 명도만 보면 순수 파랑(#0000FF, L=0.5)처럼 명도는 중간인데 휘도가 낮은 색이 빠진다.
 */
const MIN_LUMINANCE = 0.2
/** HSL 명도 반전 매핑의 기준 — L∈[0, 0.5) 를 [0.93, 0.5] 로 뒤집는다 */
const DARK_LIGHTNESS = 0.5
/** 순흑(L=0)이 반전됐을 때의 명도 — 앱 --foreground(oklch 0.93) 과 비슷하게 순백보다 살짝 낮춘다 */
const MAX_LIGHTNESS = 0.93

/**
 * 같은 색 문자열의 변환 결과를 기억한다. Outlook 메일은 거의 모든 요소에 같은 `color:rgb(0,0,0)` 을, 뉴스레터는 수백 셀에
 * 같은 배경색 몇 개를 쓰므로 요소마다 다시 계산하지 않는다. 메일마다 색 종류는 적지만 상한을 둬 무한히 쌓이지 않게 한다.
 */
function memoize(fn: (value: string) => string | null): (value: string) => string | null {
  const cache = new Map<string, string | null>()
  return (value) => {
    const hit = cache.get(value)
    if (hit !== undefined) return hit
    if (cache.size >= 2000) cache.clear()
    const result = fn(value)
    cache.set(value, result)
    return result
  }
}

/**
 * 색상(hue)·채도는 두고 명도만 start → limit 쪽으로 옮겨, ok(휘도) 를 만족하는 start 에 가장 가까운 명도의 rgb 문자열을 돌려준다.
 * 휘도는 명도에 따라 한 방향으로만 변하므로 이진 탐색으로 찾는다(limit 에서도 못 맞추면 limit). 알파는 원본 그대로.
 */
function fitLuminance(c: Rgba, start: number, limit: number, ok: (luminance: number) => boolean): string {
  const [h, s] = rgbToHsl(c.r, c.g, c.b)
  const lum = (l: number) => relativeLuminance(...hslToRgb(h, s, l))
  let best = start
  if (!ok(lum(start))) {
    let lo = start
    best = limit
    for (let i = 0; i < 12; i++) {
      const mid = (lo + best) / 2
      if (ok(lum(mid))) best = mid
      else lo = mid
    }
  }
  const [r, g, b] = hslToRgb(h, s, best)
  return c.a < 1 ? `rgba(${r}, ${g}, ${b}, ${c.a})` : `rgb(${r}, ${g}, ${b})`
}

/**
 * 어두운 색(휘도 < MIN_LUMINANCE)이면 색상(hue)은 유지한 채 명도만 밝힌 rgb 문자열을, 이미 읽히는 색이거나 해석 불가면 null 을 돌려준다.
 * 명도 L∈[0, 0.5) 는 [0.93, 0.5] 로 선형 매핑(검정 → 밝은 회백, 회색은 비례)하고, 그래도 휘도가 모자라면
 * (파랑·보라처럼 명도 대비 휘도가 낮은 색) 기준 휘도에 닿을 때까지 명도를 더 올린다.
 */
export const lightenDarkColor = memoize((value) => {
  const c = parseCssColor(value)
  if (!c || relativeLuminance(c.r, c.g, c.b) >= MIN_LUMINANCE) return null
  const l = rgbToHsl(c.r, c.g, c.b)[2]
  const start = l < DARK_LIGHTNESS ? MAX_LIGHTNESS - (l / DARK_LIGHTNESS) * (MAX_LIGHTNESS - DARK_LIGHTNESS) : l
  return fitLuminance(c, start, MAX_LIGHTNESS, (lum) => lum >= MIN_LUMINANCE)
})

/**
 * 배경색 하나를 다크 바탕용으로 바꾼다. 흰색·거의 흰색이면 'transparent'(앱 배경이 비치게), 밝은 유색이면 색상(hue)·채도는 유지한 채
 * 휘도가 MAX_BG_LUMINANCE 이하가 되도록 어둡게 한 rgb 문자열, 이미 어둡거나 해석 불가(키워드·이미지 등)면 null(원본 유지).
 * 명도를 먼저 뒤집어(밝을수록 더 어둡게) 상대적 차이를 남긴 뒤, 채도 높은 색(노랑 등)은 휘도 목표까지 더 내린다.
 */
export const darkenLightBackground = memoize((value) => {
  const c = parseCssColor(value)
  if (!c || c.a === 0) return null
  if (c.r >= NEAR_WHITE && c.g >= NEAR_WHITE && c.b >= NEAR_WHITE) return 'transparent'
  if (relativeLuminance(c.r, c.g, c.b) <= MAX_BG_LUMINANCE) return null
  const start = Math.min(1 - rgbToHsl(c.r, c.g, c.b)[2], 0.3)
  return fitLuminance(c, start, 0, (lum) => lum <= MAX_BG_LUMINANCE)
})

/**
 * 배경 이미지·그라데이션 위에 덮는 반투명 검정. 이미지는 색을 바꿀 수 없으므로 밝은 사진·그라데이션도 어둡게 눌러,
 * 그 위에서 밝아진 글자가 읽히게 한다(흰 이미지 → 휘도 ≈0.07, 반전된 검정 글자와 대비 ≈7:1).
 * inset box-shadow 는 배경(이미지 포함) 위·내용 아래에 그려진다 — 배경 레이어를 하나 끼워 넣으면 레이어별
 * background-repeat·position·size 목록이 한 칸씩 밀리므로 배경 목록은 건드리지 않는다.
 */
const IMAGE_SHADE = 'inset 0 0 0 9999px rgba(0, 0, 0, 0.7)'
/** 배경 값에 이미지 레이어(url·그라데이션)가 있는지 */
const HAS_IMAGE = /url\(|gradient\(/i
/**
 * background 값 안의 색 후보 토큰. url(...) 은 통째로 잡아 그 안의 `white.png` 같은 이름이 색으로 읽히지 않게 한다
 * (url 토큰은 색으로 해석되지 않아 그대로 남는다). hex·함수 표기는 parseCssColor 가 읽는 것과 같게.
 */
const BG_VALUE_TOKEN = /url\([^)]*\)|#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?:rgb|hsl)a?\([^)]*\)|[a-z]+/gi

/** 배경 값 속 색 토큰을 어둡게 — 인라인 style 과 <style> 이 같은 규칙을 탄다(이미지·키워드 토큰은 그대로) */
function darkenBackgroundValue(value: string): string {
  return value.replace(BG_VALUE_TOKEN, (t) => darkenLightBackground(t) ?? t)
}

/**
 * <style> 텍스트의 배경·글자색에 같은 규칙을 적용한다 — 클래식 Outlook 의 `a:link{color:#0563C1}`·뉴스레터 `td{background:#fff url(..)}` 등.
 * 이미지가 있는 배경 선언 앞에는 덮개(box-shadow) 선언을 끼운다 — 뒤에 붙이면 `!important` 가 덮개 쪽으로 넘어간다.
 */
function darkenStyleSheet(css: string): string {
  return css
    .replace(SHEET_BG_DECL, (_, pre: string, prop: string, sep: string, value: string) => {
      const shade = HAS_IMAGE.test(value) && !/-color$/i.test(prop) ? `box-shadow:${IMAGE_SHADE};` : ''
      return `${pre}${shade}${prop}${sep}${/-image$/i.test(prop) ? value : darkenBackgroundValue(value)}`
    })
    .replace(SHEET_COLOR_DECL, (m, pre: string, decl: string, value: string) => {
      const next = lightenDarkColor(value)
      return next ? `${pre}${decl}${next}` : m
    })
}

/** 레거시 색 속성 값을 CSS 색으로 — 해석할 수 없으면 '' */
function legacyColor(raw: string): string {
  if (parseCssColor(raw)) return raw
  // 레거시 색 파싱처럼 앞쪽 hex 만 살린다 — `ffffff`·`#F2F2F2;` 같이 # 이 없거나 뒤에 군더더기가 붙은 값
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(raw)
  return hex ? `#${hex[1]}` : ''
}

/** 레거시 `bgcolor`·`background` 속성을 브라우저가 실제로 반영하는 요소 — 다른 요소의 속성은 원래도 화면에 안 보인다 */
const LEGACY_BG_HOSTS = ['body', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']

/**
 * 레거시 표현 속성(`bgcolor`·`background`·`<font color>`)을 같은 뜻의 인라인 style 로 옮긴다 — 인라인이 속성보다 우선하므로
 * 화면은 같고, 이후 인라인 style 한 경로에서 같은 규칙을 탄다. 인라인에 이미 그 속성이 있으면 그쪽이 이기므로 속성만 지운다.
 * 해석할 수 없는 값은 CSS 로 옮기면 거부돼 색이 사라지므로 속성 그대로 둔다.
 */
function moveLegacyAttr(el: HTMLElement, attr: string, prop: 'backgroundColor' | 'backgroundImage' | 'color'): void {
  const raw = (el.getAttribute(attr) ?? '').trim()
  const value = prop === 'backgroundImage' ? (raw && `url("${raw.replace(/"/g, '%22')}")`) : legacyColor(raw)
  if (!value) return
  if (!el.style[prop]) el.style[prop] = value
  el.removeAttribute(attr)
}

/**
 * 다크 테마용 메일 HTML 로 변환한다 — 메일 종류와 관계없이 모든 HTML 메일에 같은 색 단위 규칙을 적용한다.
 * DOMParser 재직렬화는 <!DOCTYPE> 를 떨어뜨려 표준/쿼크 모드(표 레이아웃)가 바뀌므로 원본 doctype 을 다시 붙인다.
 */
export function applyMailDarkMode(html: string, colors: MailThemeColors): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const hosts = (attr: string) => doc.querySelectorAll<HTMLElement>(LEGACY_BG_HOSTS.map((t) => `${t}[${attr}]`).join(','))
  for (const el of hosts('bgcolor')) moveLegacyAttr(el, 'bgcolor', 'backgroundColor')
  for (const el of hosts('background')) moveLegacyAttr(el, 'background', 'backgroundImage')
  for (const el of doc.querySelectorAll<HTMLElement>('font[color]')) moveLegacyAttr(el, 'color', 'color')

  // background 단축값도 backgroundColor·backgroundImage 로 풀려 있다 — 값은 한 번씩만 읽고, 바뀐 것만 다시 쓴다(쓸 때마다 style 재직렬화)
  for (const el of doc.querySelectorAll<HTMLElement>('[style]')) {
    const { backgroundColor, backgroundImage, color } = el.style
    if (backgroundColor) {
      const next = darkenBackgroundValue(backgroundColor)
      if (next !== backgroundColor) el.style.backgroundColor = next
    }
    if (HAS_IMAGE.test(backgroundImage)) {
      el.style.boxShadow = el.style.boxShadow ? `${IMAGE_SHADE}, ${el.style.boxShadow}` : IMAGE_SHADE
    }
    const nextColor = color ? lightenDarkColor(color) : null
    if (nextColor) el.style.color = nextColor
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
