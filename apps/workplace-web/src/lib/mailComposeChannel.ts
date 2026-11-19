// 메일 작성 새 창(WP-1535) ↔ 메인 창 알림 통로.
// 새 창은 자기 쿼리 캐시만 가진다 — 거기서 보내거나 닫거나 버려도 메인 창의 보낸편지함·임시보관함은 모른다.
// 그래서 새 창이 끝날 때 무슨 일이 있었는지(어느 계정·임시저장, 어느 창이 열었나) 알리고, 메인 창들이 그 목록을 다시 받는다.
// 결과 토스트는 그 새 창을 연 창만 띄운다(다른 탭은 조용히 목록만 갱신).
// 1차는 BroadcastChannel(같은 출처의 모든 창), 없는 브라우저면 window.opener.postMessage(같은 출처만)로 보낸다.
import { toast } from 'sonner';

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
  /** sent 일 때 대기열에 올라간 행 id(WP-1786) — 메인 창 「되돌리기」가 되돌린다. 쓰던 임시저장이 없어졌으면 draftId 와 다르다. */
  sentDraftId?: number;
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
const MAIL_COMPOSE_WINDOW_FEATURES = 'popup=yes,width=900,height=760';

/** 새 창 이름 — 열 때마다 다르게 해 이미 열린 다른 작성 창을 덮어쓰지 않는다(여러 창 동시 허용). */
let popoutSeq = 0;
const nextPopoutName = () => `mail-compose-${Date.now()}-${++popoutSeq}`;

/**
 * 작성용 빈 새 창을 연다 — 팝업 차단을 피하려 사용자 클릭 처리 중에 불러야 한다. 막히면 null.
 * 주소는 정하지 않고 먼저 열어 두며, 호출부(작성창 ↗ WP-1535·작성 방식 기본값 「새 창」·임시보관함 열기 WP-1744)가
 * 임시저장 id 를 알게 된 뒤 location.href 로 주소를 정한다. 어느 길이든 같은 이름 규칙·크기로 연다.
 */
export function openMailComposeWindow(): Window | null {
  return window.open('', nextPopoutName(), MAIL_COMPOSE_WINDOW_FEATURES);
}

/** 팝업 차단 안내 — 새 창을 열지 못했을 때(↗·작성 방식 기본값 「새 창」·임시보관함에서 새 창으로 열기) 같은 문구로 알린다. */
export function toastMailComposePopupBlocked(): void {
  toast.error('팝업이 막혀 새 창으로 열지 못했어요', { description: '브라우저에서 이 사이트의 팝업을 허용해 주세요' });
}

/** 메시지 모양 확인 — 다른 postMessage(OAuth 콜백 등)와 섞이지 않게. */
export function isMailComposeWindowMessage(data: unknown): data is MailComposeWindowMessage {
  if (typeof data !== 'object' || data == null) return false;
  const m = data as Partial<MailComposeWindowMessage>;
  return (
    m.source === MAIL_COMPOSE_CHANNEL &&
    (MAIL_COMPOSE_WINDOW_EVENTS as readonly unknown[]).includes(m.type) &&
    typeof m.accountId === 'number' &&
    typeof m.draftId === 'number' &&
    (m.opener === null || typeof m.opener === 'string') &&
    (m.sentDraftId === undefined || typeof m.sentDraftId === 'number')
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

/**
 * 듣는 창 표식(WP-1786 코드 리뷰) — 메인 창이 새 창 알림을 듣는 동안 자기 window 에 자기 id 를 적어 둔다. 새 창이 보낸 뒤 「메일 보냄 · 되돌리기」를
 * 맡길 메인 창이 아직 있는지(닫히지도 새로 고쳐지지도 않았는지) 같은 출처 opener 에서 바로 읽어 본다 — 알림 통로에는 받았다는 답(ack)이 없다.
 */
const MAIL_COMPOSE_LISTENER_KEY = '__wpMailComposeListener';
/** 이 창에서 듣는 수 — StrictMode 의 두 번 걸기·여러 곳의 듣기에도 마지막 하나가 그만둘 때만 표식을 지운다. */
let listenerCount = 0;

/**
 * 이 새 창을 연 메인 창이 지금도 이 창의 알림을 받아 토스트를 띄울 수 있는가 — opener 가 있고, 닫히지 않았고, 그 창이 듣는 id 가 주소의 opener 와
 * 같다(새로 고쳐졌으면 id 가 바뀐다). 접근할 수 없으면(다른 출처로 이동 등) false.
 */
export function isOpenerListening(openerId: string | null): boolean {
  if (!openerId) return false;
  try {
    const o = window.opener as (Window & Record<string, unknown>) | null;
    if (!o || o.closed) return false;
    return o[MAIL_COMPOSE_LISTENER_KEY] === openerId;
  } catch {
    return false;
  }
}

/** 메인 창이 새 창 알림을 듣는다. 돌려준 함수로 그만 듣는다. 듣는 동안 이 창이 듣는다는 표식(id)을 남긴다(isOpenerListening). */
export function listenMailComposeWindowEvents(onMessage: (m: MailComposeWindowMessage) => void): () => void {
  const self = window as unknown as Record<string, unknown>;
  listenerCount += 1;
  self[MAIL_COMPOSE_LISTENER_KEY] = MAIL_COMPOSE_WINDOW_ID;
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
    listenerCount -= 1;
    if (listenerCount === 0) delete self[MAIL_COMPOSE_LISTENER_KEY];
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
