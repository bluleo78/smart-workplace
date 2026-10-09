import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 색 토큰 대비 테스트 공용 도우미 — index.css 원본 값을 읽어 WCAG 대비를 브라우저 없이 계산한다.
// presenceTokens.test(접속자 색)·statusTextTokens.test(버전 비교 추가·삭제 문구)가 함께 쓴다.
// oklch → 선형 sRGB(OKLab 표준 행렬, 색역 밖은 자름) → WCAG 상대 휘도. 토큰은 리터럴 oklch 여야 읽힌다(var()·color-mix 는 못 읽는다).

const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8')

function block(re: RegExp): string {
  const m = re.exec(css)
  if (!m) throw new Error(`블록을 찾지 못함: ${re}`)
  return m[1]
}

/** 테마별 토큰 블록 본문 — 라이트(:root)·다크(.dark). */
export const THEMES = {
  light: block(/^:root \{([\s\S]*?)^\}/m),
  dark: block(/^\.dark \{([\s\S]*?)^\}/m),
}

/**
 * 브랜드 테마(ocean·sunset)까지 포함한 6조합 — 브랜드 블록은 일부 토큰만 덮으므로 덮는 블록을 앞에 붙여(oklchOf 는 첫 일치를 쓴다)
 * 나머지는 기본 라이트/다크 값으로 떨어지게 한다(WP-322).
 */
export const BRAND_THEMES = {
  ...THEMES,
  'ocean-light': block(/^\.theme-ocean \{([\s\S]*?)^\}/m) + THEMES.light,
  'ocean-dark': block(/^\.theme-ocean\.dark, \.dark \.theme-ocean \{([\s\S]*?)^\}/m) + THEMES.dark,
  'sunset-light': block(/^\.theme-sunset \{([\s\S]*?)^\}/m) + THEMES.light,
  'sunset-dark': block(/^\.theme-sunset\.dark, \.dark \.theme-sunset \{([\s\S]*?)^\}/m) + THEMES.dark,
}

/** 블록 안 토큰의 oklch(L C h). 줄 시작(공백 뒤)에서만 찾는다 — 다른 토큰 이름의 꼬리와 섞이지 않게. */
export function oklchOf(body: string, name: string): [number, number, number] {
  const m = new RegExp(`(?:^|\\s)--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`, 'm').exec(body)
  if (!m) throw new Error(`--${name} 없음`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** oklch → 선형 sRGB [r,g,b](OKLab 표준 행렬, 색역 밖 성분은 0..1 로 자른다 — 브라우저와 같은 방향). */
function linearSrgbOf([L, C, h]: [number, number, number]): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** 선형 sRGB → WCAG 상대 휘도(가중합). */
const luminanceOfLinear = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** oklch → WCAG 상대 휘도. */
export const luminance = (lch: [number, number, number]) => luminanceOfLinear(linearSrgbOf(lch))

/** 선형 sRGB 성분 → 감마 인코딩 sRGB(0..1). 반투명 합성은 브라우저처럼 인코딩된 sRGB 에서 한다. */
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

/**
 * 반투명 채움(bg-x/90 등)을 바탕 토큰 위에 합성한 색의 상대 휘도 — hover 처럼 투명도로 칠한 바탕 위 글자 대비를 잴 때 쓴다.
 * fill 을 alpha 만큼 under 위에 sRGB 로 섞는다(브라우저 합성과 같은 방식).
 */
export function compositeLuminance(body: string, fill: string, alpha: number, under: string): number {
  const f = linearSrgbOf(oklchOf(body, fill)).map(encode)
  const u = linearSrgbOf(oklchOf(body, under)).map(encode)
  return luminanceOfLinear(f.map((v, i) => decode(v * alpha + u[i] * (1 - alpha))))
}

/** 두 상대 휘도의 WCAG 대비. */
export const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)

/** 한 테마 블록에서 두 토큰의 대비. */
export const tokenContrast = (body: string, a: string, b: string) => contrast(luminance(oklchOf(body, a)), luminance(oklchOf(body, b)))
