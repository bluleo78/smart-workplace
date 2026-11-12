// Gen:iA 브라우저 로그인(WP-1461) 화면 규칙 — 상태를 다시 묻는 간격과 「남은 시간」 문구.
// 진행 상태는 API 가 메모리에 들고 있고, 웹이 이 간격으로 상태를 물을 때 API 가 Gen:iA 에 토큰을 폴링한다(웹이 멈추면 폴링도 멈춘다).

/** 대기(PENDING) 중 상태를 다시 묻는 간격(ms). */
export const GENIA_LOGIN_POLL_MS = 2000;

/**
 * 만료까지 남은 시간 문구 — 「남은 시간 M:SS」. 지났으면 0:00.
 * 초는 올림한다 — 막 받은 10분 진행이 응답을 그리는 몇 ms 사이에 9:59 로 시작하지 않게.
 */
export function formatGeniaLoginRemaining(expiresAt: string, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `남은 시간 ${m}:${String(s).padStart(2, '0')}`;
}
