/**
 * 캔버스 백킹 스토어 최대 픽셀 수 — iOS Safari 는 약 16.7M(4096×4096) 픽셀을 넘는 캔버스를
 * 그리지 못하거나 비워 버린다. 확대(zoom)·고배율 화면에서도 이 한도를 넘지 않게 해상도를 낮춘다.
 */
export const MAX_CANVAS_PIXELS = 16_777_216

/**
 * CSS 1px 당 캔버스 픽셀 배율을 정한다 — 기본은 devicePixelRatio 이되, 가로×세로 픽셀이
 * maxPixels 를 넘으면 그 한도에 맞게 줄인다(CSS 크기는 그대로, 해상도만 낮아진다).
 * 잘못된 입력(0 이하·NaN)은 1 로 본다.
 */
export function capRenderScale(cssWidth: number, cssHeight: number, dpr: number, maxPixels = MAX_CANVAS_PIXELS): number {
  const want = dpr > 0 ? dpr : 1
  const area = cssWidth * cssHeight
  if (!(area > 0)) return want
  const limit = Math.sqrt(maxPixels / area)
  return Math.min(want, limit)
}
