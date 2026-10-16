import type { ConvertedPreviewResponse } from '../../api/drive'

/** 변환 중(202)일 때 다시 묻는 간격 — 변환은 보통 수 초라 1.5초면 체감 지연 없이 서버 부담도 적다(WP-431). */
export const CONVERT_POLL_INTERVAL_MS = 1500
/**
 * 한 시도(열기·[다시 시도])당 폴링 상한 — 넘기면 일시 실패 화면으로 바꿔 무한 대기를 막는다.
 * 서버 한 작업의 예산(변환 타임아웃 75초 + BUSY 재시도 대기)보다 길어야 한다 — 짧으면 서버가 곧 끝낼 변환을 웹이 먼저 실패로 보인다.
 */
export const CONVERT_POLL_MAX_MS = 90_000

/**
 * 변환 미리보기 화면 상태.
 * converting = 변환 중 안내, ready = 변환 PDF 표시, failed = 실패(transient 면 [다시 시도] 제공), unsupported = 변환 대상 아님(원래 렌더러 안내로),
 * error = 대상 아님이 아닌 404(휴지통·권한 없음·원본 유실) — 뷰어의 오류 화면.
 */
export type ConvertedState =
  | { s: 'converting' }
  | { s: 'ready'; blob: Blob }
  | { s: 'failed'; code: string; transient: boolean }
  | { s: 'unsupported' }
  | { s: 'error' }

/** API 응답 → 화면 상태. 202 는 상태가 아니라 "다시 물어라" 신호라 'poll' 로 돌려준다. */
export function toConvertedState(r: ConvertedPreviewResponse): ConvertedState | 'poll' {
  switch (r.status) {
    case 200:
      return { s: 'ready', blob: r.blob }
    case 202:
      return 'poll'
    case 422:
      return { s: 'failed', code: r.code, transient: r.transient }
    case 404:
      return { s: 'unsupported' }
    case 'error':
      return { s: 'error' }
  }
}
