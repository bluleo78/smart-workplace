// 뷰어 영상·오디오 재생 판정 순수 로직(WP-281). MediaPlayer·AttachmentViewer 는 이 결과대로만 움직인다.
// 왜 순수 함수인가: 자동재생 대상·진행률·탐색 경계·크기 맞춤은 브라우저 없이 경계값까지 검증해야 회귀를 잡는다(스펙 §8.1).

/** ←/→ 탐색 한 번의 이동(초) — 브라우저 기본 컨트롤·시안(#6)과 같은 5초. */
export const MEDIA_SEEK_SECONDS = 5
/** 영상 재생 시작 뒤 모바일 상·하단 바를 숨기기까지(ms) — 사진 앱 동작, 스펙 §5.3 #2 의 2~3초. */
export const AUTO_HIDE_BARS_MS = 3000
/**
 * 전체화면 해제 직후 이 시간(ms) 안에 온 Esc 는 뷰어 닫기로 쓰지 않는다 —
 * 브라우저가 전체화면 해제에 Esc 를 쓰고도 keydown 을 페이지에 늦게 넘기는 경우 이중 닫기를 막는다(스펙 §5.3 #7).
 */
export const FULLSCREEN_ESC_GUARD_MS = 500

/**
 * 이 항목을 자동재생하는가(스펙 §5.3 #5) — 사용자가 직접 눌러 연 항목(뷰어를 연 순간의 항목)만, 그 항목을 한 번도 떠나지 않은 동안만.
 * 넘겨서 온 항목·떠났다 되돌아온 항목은 정지 상태(위치는 기억).
 * "한 번만 소비" 가 아니라 "떠난 적 있음" 표식으로 판정한다 — StrictMode 이중 마운트에서도 같은 답이 나와야 한다.
 */
export function shouldAutoplay(i: { key: string; openedKey: string; leftOpened: boolean }): boolean {
  return i.key === i.openedKey && !i.leftOpened
}

/**
 * 받은 비율(0~100 정수, 내림) — 분모는 응답 전체 크기(Content-Length), 없으면 항목 메타 크기. 둘 다 모르면 null(% 없이 "받는 중").
 * 메타 크기가 실제보다 작아도 100 을 넘기지 않는다.
 */
export function progressPercent(loaded: number, total: number | null | undefined, fallback: number | null | undefined): number | null {
  const denom = total != null && total > 0 ? total : fallback != null && fallback > 0 ? fallback : null
  if (denom == null) return null
  return Math.min(100, Math.max(0, Math.floor((loaded / denom) * 100)))
}

/** 탐색 목표 시각(초) — 0 ~ 길이로 자른다. 길이를 아직 모르면(NaN·Infinity) 아래쪽만 자른다. */
export function seekTarget(current: number, delta: number, duration: number): number {
  const t = Math.max(0, current + delta)
  return Number.isFinite(duration) && duration > 0 ? Math.min(duration, t) : t
}

/** 전체화면이 방금(가드 시간 안) 풀렸는가 — 해제 시각을 모르면(한 번도 전체화면이 아니었음) 거짓. */
export function fullscreenJustExited(exitedAt: number | null, now: number): boolean {
  return exitedAt != null && now - exitedAt <= FULLSCREEN_ESC_GUARD_MS
}

/**
 * 영상 표시 크기 — 상자(본문 영역) 안에 비율을 지켜 가득 맞춘다(object-contain 과 같은 결과를 요소 크기로).
 * 이미지(fitImageWidth)와 달리 원본보다 키운다 — 작은 영상도 재생 막대·가운데 버튼이 쓸 만한 크기가 되게.
 * 요소 자체를 영상 크기로 줄이는 이유: 요소 밖 여백 탭 = 바 토글, 요소 위 탭 = 컨트롤 표시(스펙 §5.3 #2)를 나누려면 레터박스가 요소 밖이어야 한다.
 * 정수 px 로 내린다(반올림으로 상자를 넘쳐 스크롤바가 생기지 않게). 크기를 모르면 null.
 */
export function fitMediaSize(naturalW: number, naturalH: number, boxW: number, boxH: number): { w: number; h: number } | null {
  if (naturalW <= 0 || naturalH <= 0 || boxW <= 0 || boxH <= 0) return null
  const scale = Math.min(boxW / naturalW, boxH / naturalH)
  return { w: Math.floor(naturalW * scale), h: Math.floor(naturalH * scale) }
}
