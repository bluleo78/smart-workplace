import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 색 토큰 대비 테스트 공용 도우미 — index.css 원본 값을 읽어 WCAG 대비를 브라우저 없이 계산한다.
// presenceTokens.test(접속자 색)·statusTextTokens.test(버전 비교 추가·삭제 문구)가 함께 쓴다.
// oklch → 선형 sRGB(OKLab 표준 행렬, 색역 밖은 자름) → WCAG 상대 휘도. 토큰은 리터럴 oklch 여야 읽힌다(var()·color-mix 는 못 읽는다).

/** index.css 원문 — 토큰 값이 아닌 규칙(구분선 기본 색 등)을 확인하는 테스트도 함께 쓴다. */
export const css = readFileSync(fileURLToPath(new URL('../../index.css', import.meta.url)), 'utf8')

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

/** 블록 안 토큰의 oklch(L C h [/ a%]) — 투명도가 없으면 1. 줄 시작(공백 뒤)에서만 찾는다 — 다른 토큰 이름의 꼬리와 섞이지 않게. */
function oklchAlphaOf(body: string, name: string): { lch: [number, number, number]; alpha: number } {
  const m = new RegExp(
    `(?:^|\\s)--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*/\\s*([\\d.]+)%)?\\)`,
    'm',
  ).exec(body)
  if (!m) throw new Error(`--${name} 없음`)
  return { lch: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] == null ? 1 : Number(m[4]) / 100 }
}

/** 블록 안 불투명 토큰의 oklch(L C h). 반투명 토큰은 단독 휘도가 뜻이 없으므로 거부한다(겹쳐 잴 때는 stackedLuminance). */
export function oklchOf(body: string, name: string): [number, number, number] {
  const { lch, alpha } = oklchAlphaOf(body, name)
  if (alpha !== 1) throw new Error(`--${name} 는 반투명 — stackedLuminance 로 겹쳐 잰다`)
  return lch
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

/** 두 상대 휘도의 WCAG 대비. */
export const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)

/** 한 테마 블록에서 두 토큰의 대비. */
export const tokenContrast = (body: string, a: string, b: string) => contrast(luminance(oklchOf(body, a)), luminance(oklchOf(body, b)))

/** 겹칠 한 층 — 토큰 이름, 또는 [이름, 투명도 배율](bg-x/50 처럼 유틸리티가 토큰 투명도에 곱하는 값). */
export type Layer = string | [string, number]

/**
 * 토큰을 아래에서 위로 겹쳐(첫 층이 맨 아래, 그 투명도는 무시) 각자의 투명도로 sRGB 합성한 색의 상대 휘도(브라우저 합성과 같은 방식).
 * 예: ['background', 'card', 'switch-off-border'] — 다크 카드(바탕 위 흰 3%) 위의 반투명 테두리. ['background', 'card', ['muted', 0.5]] — 카드 머리(bg-muted/50).
 */
export function stackedLuminance(body: string, layers: Layer[]): number {
  const [bottom, ...rest] = layers.map((l) => {
    const [name, factor] = typeof l === 'string' ? [l, 1] : l
    const { lch, alpha } = oklchAlphaOf(body, name)
    return { rgb: linearSrgbOf(lch).map(encode), alpha: alpha * factor }
  })
  let rgb = bottom.rgb
  for (const top of rest) rgb = rgb.map((u, i) => top.rgb[i] * top.alpha + u * (1 - top.alpha))
  return luminanceOfLinear(rgb.map(decode))
}
