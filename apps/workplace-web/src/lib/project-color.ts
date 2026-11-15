// 프로젝트 시각 식별자 — 백엔드에 색상 필드가 없어 key 해시로 결정적 색을 생성한다.
// 같은 key 는 항상 같은 색(hue). 사이드바 프로젝트 항목의 컬러 사각형에 사용.
import { hslToRgb, relativeLuminance } from './cssColor'

/** 문자열 → 32bit unsigned 해시 — 같은 입력은 항상 같은 출력. 프로젝트·이름 색, 외부 참석자 아바타 색 시드(WP-708)에 쓴다. */
export function hashString(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0
  return h
}

// ── 흰 글자 대비 보장(WP-1620) ──
// 채도 60%·명도 45% 고정이면 노랑~청록(hue 약 21°~206°)에서 흰 글자 대비가 WCAG AA 4.5:1 에 못 미친다(60° 에서 2.12:1).
// 그래서 hue 마다 명도를 45% 에서 1% 씩 낮춰, 대비가 4.5 이상이 되는 첫 명도를 쓴다.
// 이미 대비가 되는 hue(파랑·보라·빨강 쪽)는 45% 그대로라 기존 색이 바뀌지 않는다.
// 다크/라이트 테마와 무관하게 같은 색이다(식별색은 테마 고정 규칙).

/** 식별색 채도(%) — 모든 hue 공통. */
const SATURATION = 60
/** 시작 명도(%) — 대비가 되면 이 값을 그대로 쓴다. */
const BASE_LIGHTNESS = 45
/** 흰 글자 최소 대비(WCAG 2.x AA, 일반 글자). */
const MIN_WHITE_CONTRAST = 4.5
/** 흰 전경색 — 모든 식별색 공통. */
const WHITE_FG = 'hsl(0 0% 100%)'

/** 흰색 상대 휘도 — 대비 계산의 밝은 쪽. */
const WHITE_LUMINANCE = 1

/**
 * hue 하나의 명도(%) — 45% 에서 1% 씩 낮추며, 브라우저가 칠할 8비트 sRGB(반올림)로 잰 흰 글자 대비가 처음 4.5 이상이 되는 값.
 * 변환·휘도는 메일 다크 모드 보정(mailDarkMode)과 같은 공용 함수(cssColor)를 쓴다 — 같은 색을 모듈마다 다르게 재지 않게.
 */
function contrastSafeLightness(hue: number): number {
  let lightness = BASE_LIGHTNESS
  // 명도 0% 는 검정이라 대비 21:1 — 루프는 반드시 끝난다.
  while (lightness > 0) {
    const [r, g, b] = hslToRgb(hue / 360, SATURATION / 100, lightness / 100)
    const lum = relativeLuminance(r, g, b)
    if ((WHITE_LUMINANCE + 0.05) / (lum + 0.05) >= MIN_WHITE_CONTRAST) break
    lightness--
  }
  return lightness
}

/** hue 0..359 → 배경색 표 — 상수만으로 정해지므로 모듈을 불러올 때 한 번 만든다(렌더마다 계산·숨은 캐시 상태 없음). */
const BG_BY_HUE: readonly string[] = Array.from(
  { length: 360 },
  (_, hue) => `hsl(${hue} ${SATURATION}% ${contrastSafeLightness(hue)}%)`,
)

/**
 * hue → 흰 글자 대비 4.5:1 이상인 결정적 배경/전경색(WP-1620).
 * 음수·소수·360 이상도 같은 원 위의 정수 hue 로 맞춘다 — CSS 가 칠하는 색과 대비를 잰 색이 어긋나지 않게.
 */
export function initialColor(hue: number): { bg: string; fg: string } {
  const h = ((Math.round(hue) % 360) + 360) % 360
  return { bg: BG_BY_HUE[h], fg: WHITE_FG }
}

/** key 문자열 → 결정적 HSL 배경/전경색. 흰 글자 대비는 initialColor 가 보장한다(WP-1620). */
export function projectColor(key: string): { bg: string; fg: string } {
  return initialColor(hashString(key) % 360)
}

/** key 앞 1–2자 대문자 — 컬러 사각형 안에 표시. */
export function projectInitial(key: string): string {
  return key.slice(0, 2).toUpperCase()
}

/** 이름 문자열 → 결정적 HSL 색(멤버 아바타 배경). 흰 글자 대비는 initialColor 가 보장한다(WP-1620). */
export function nameColor(name: string): { bg: string; fg: string } {
  return initialColor(hashString(name) % 360)
}

/** 이름 첫 글자(대문자) — 아바타 안에 표시. */
export function nameInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}
