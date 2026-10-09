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

/** 블록 안 토큰의 oklch(L C h). 줄 시작(공백 뒤)에서만 찾는다 — 다른 토큰 이름의 꼬리와 섞이지 않게. */
export function oklchOf(body: string, name: string): [number, number, number] {
  const m = new RegExp(`(?:^|\\s)--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`, 'm').exec(body)
  if (!m) throw new Error(`--${name} 없음`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** oklch → WCAG 상대 휘도(선형 sRGB 가중합). 색역 밖 성분은 0..1 로 자른다(브라우저와 같은 방향). */
export function luminance([L, C, h]: [number, number, number]): number {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

/** 두 상대 휘도의 WCAG 대비. */
export const contrast = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)

/** 한 테마 블록에서 두 토큰의 대비. */
export const tokenContrast = (body: string, a: string, b: string) => contrast(luminance(oklchOf(body, a)), luminance(oklchOf(body, b)))
