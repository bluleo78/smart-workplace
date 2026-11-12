// 메일 작성 새 창(WP-1535) ↔ 메인 창 알림 통로.
// 새 창은 자기 쿼리 캐시만 가진다 — 거기서 보내거나 닫거나 버려도 메인 창의 보낸편지함·임시보관함은 모른다.
// 그래서 새 창이 끝날 때 무슨 일이 있었는지(어느 계정·임시저장, 어느 창이 열었나) 알리고, 메인 창들이 그 목록을 다시 받는다.
// 결과 토스트는 그 새 창을 연 창만 띄운다(다른 탭은 조용히 목록만 갱신).
// 1차는 BroadcastChannel(같은 출처의 모든 창), 없는 브라우저면 window.opener.postMessage(같은 출처만)로 보낸다.

/** 새 창이 끝난 이유 — sent(보냄) / saved(닫으며 임시저장) / discarded(버림) / closed(알릴 결과 없음 — OS 닫기·빈 작성 정리). */
export const MAIL_COMPOSE_WINDOW_EVENTS = ['sent', 'saved', 'discarded', 'closed'] as const;
export type MailComposeWindowEvent = (typeof MAIL_COMPOSE_WINDOW_EVENTS)[number];

/** BroadcastChannel 이름 겸 postMessage 표식. */
export const MAIL_COMPOSE_CHANNEL = 'wp-mail-compose';

/** 창 사이 메시지. accountId 는 다시 받을 목록의 계정, draftId 는 새 창이 쓰던 임시저장, opener 는 새 창을 연 창의 id(모르면 null). */
export interface MailComposeWindowMessage {
  source: typeof MAIL_COMPOSE_CHANNEL;
  type: MailComposeWindowEvent;
  accountId: number;
  draftId: number;
  opener: string | null;
}

/** 이 창(탭)의 id — 새 창 주소에 실어, 끝났다는 알림이 "내가 연 창"에서 왔는지 가린다. 문서마다 새로 정한다. */
export const MAIL_COMPOSE_WINDOW_ID: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** 새 창 주소 — 그 임시저장을 연다. opener 는 연 창의 id, fresh 는 손대지 않은 작성을 새 창으로 옮기려 방금 만든 임시저장. */
export function mailComposeWindowUrl(draftId: number, opts: { opener?: string; fresh?: boolean } = {}): string {
  const q = new URLSearchParams({ draftId: String(draftId) });
  if (opts.opener) q.set('opener', opts.opener);
  if (opts.fresh) q.set('fresh', '1');
  return `/mail/compose?${q.toString()}`;
}

/** 새 창 크기 — 작성창 크게 보기(960px)와 비슷한 독립 창. */
export const MAIL_COMPOSE_WINDOW_FEATURES = 'popup=yes,width=900,height=760';

/** 메시지 모양 확인 — 다른 postMessage(OAuth 콜백 등)와 섞이지 않게. */
export function isMailComposeWindowMessage(data: unknown): data is MailComposeWindowMessage {
  if (typeof data !== 'object' || data == null) return false;
  const m = data as Partial<MailComposeWindowMessage>;
  return (
    m.source === MAIL_COMPOSE_CHANNEL &&
    (MAIL_COMPOSE_WINDOW_EVENTS as readonly unknown[]).includes(m.type) &&
    typeof m.accountId === 'number' &&
    typeof m.draftId === 'number' &&
    (m.opener === null || typeof m.opener === 'string')
  );
}

/** 새 창에서 메인 창으로 알린다. BroadcastChannel 이 없으면 opener 에 postMessage(같은 출처로만). */
export function postMailComposeWindowEvent(message: Omit<MailComposeWindowMessage, 'source'>): void {
  const full: MailComposeWindowMessage = { source: MAIL_COMPOSE_CHANNEL, ...message };
  if (typeof BroadcastChannel === 'function') {
    const ch = new BroadcastChannel(MAIL_COMPOSE_CHANNEL);
    ch.postMessage(full);
    ch.close();
    return;
  }
  try {
    window.opener?.postMessage(full, window.location.origin);
  } catch {
    /* opener 가 닫혔거나 접근할 수 없다 — 메인 창은 다음 조회 때 갱신된다 */
  }
}

/** 메인 창이 새 창 알림을 듣는다. 돌려준 함수로 그만 듣는다. */
export function listenMailComposeWindowEvents(onMessage: (m: MailComposeWindowMessage) => void): () => void {
  const onWindowMessage = (e: MessageEvent) => {
    // postMessage 폴백은 같은 출처에서 온 것만 믿는다.
    if (e.origin !== window.location.origin || !isMailComposeWindowMessage(e.data)) return;
    onMessage(e.data);
  };
  window.addEventListener('message', onWindowMessage);
  let ch: BroadcastChannel | null = null;
  if (typeof BroadcastChannel === 'function') {
    ch = new BroadcastChannel(MAIL_COMPOSE_CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      if (isMailComposeWindowMessage(e.data)) onMessage(e.data);
    };
  }
  return () => {
    window.removeEventListener('message', onWindowMessage);
    ch?.close();
  };
}

// ── 이 창이 연 새 창 목록 ─────────────────────────────────────
// 같은 임시저장을 메인 창에서 다시 열면(임시보관함) 두 번째 편집기를 만들지 않고 그 새 창을 앞으로 가져오려고 기억한다.
// 창이 닫혔거나(win.closed) 끝났다는 알림이 오면 지운다.
const popouts = new Map<number, Window>();

/** 새 창으로 옮긴 임시저장과 그 창을 기억한다. */
export function rememberMailComposePopout(draftId: number, win: Window): void {
  popouts.set(draftId, win);
}

/** 그 임시저장을 잊는다(끝났다는 알림). */
export function forgetMailComposePopout(draftId: number): void {
  popouts.delete(draftId);
}

/** 그 임시저장을 쓰는 새 창이 아직 열려 있으면 그 창. 닫혔으면 잊고 null. */
export function liveMailComposePopout(draftId: number): Window | null {
  const win = popouts.get(draftId);
  if (!win) return null;
  if (win.closed) {
    popouts.delete(draftId);
    return null;
  }
  return win;
}
