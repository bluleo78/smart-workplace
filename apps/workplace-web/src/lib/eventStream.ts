// 공용 SSE 트랜스포트 — chat/messaging/notify 통합 단일 스트림(/api/v1/events)을 fetch + ReadableStream 으로 구독한다.
// native EventSource 는 Authorization 헤더 미지원 → fetch 로 Bearer 토큰을 싣고, 401 시 직접 refresh 후 재연결한다.
// 기존 3개 훅에 중복되던 파서·백오프·401 로직을 1벌로 통합.

import { getAccessToken, refreshAccessToken } from '../api/client';

// SSE 텍스트 라인 파서(순수). feed() 로 청크 문자열을 누적·파싱하고, 이벤트 경계(빈 줄)마다 onEvent 를 호출한다.
// data 가 JSON 이면 파싱한 객체를, 아니면 undefined 를 넘긴다. ':' 코멘트(heartbeat)는 무시.
export function createSseParser(onEvent: (name: string, data: unknown) => void): {
  feed(text: string): void;
} {
  let buffer = '';
  let currentEvent = 'message';
  let currentData = '';

  const dispatch = () => {
    if (currentEvent !== 'message' || currentData) {
      let parsed: unknown;
      if (currentData) {
        try {
          parsed = JSON.parse(currentData);
        } catch {
          parsed = undefined; // 비-JSON data → undefined (notify 처럼 이름만 쓰는 이벤트 허용)
        }
      }
      try {
        onEvent(currentEvent, parsed);
      } catch {
        // 한 이벤트 처리 실패가 공유 스트림 전체를 끊지 않도록 무시(구 훅 동작 보존).
      }
    }
    currentEvent = 'message';
    currentData = '';
  };

  return {
    feed(text: string) {
      buffer += text;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          dispatch();
          continue;
        }
        if (line.startsWith(':')) continue; // heartbeat/comment
        const ci = line.indexOf(':');
        const field = ci === -1 ? line : line.slice(0, ci);
        const raw = ci === -1 ? '' : line.slice(ci + 1);
        const val = raw.startsWith(' ') ? raw.slice(1) : raw;
        if (field === 'event') currentEvent = val;
        else if (field === 'data') currentData = currentData ? `${currentData}\n${val}` : val;
      }
    },
  };
}

export interface EventStreamOptions {
  url: string;
  onEvent: (name: string, data: unknown) => void;
  onOpen?: () => void; // 연결 성공(재연결 포함) 직후 — catch-up invalidate 용
  onConnectedChange?: (connected: boolean) => void;
}

// 단일 SSE 스트림 구독. 지수 백오프 재연결 + 401 refresh 를 캡슐화한다. 반환값은 cleanup 함수.
export function subscribeEventStream(opts: EventStreamOptions): () => void {
  let cancelled = false;
  let attempt = 0;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (cancelled) return;
    const delay = Math.min(1000 * Math.pow(2, attempt), 60_000) + Math.random() * 1000;
    attempt++;
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = async () => {
    if (cancelled) return;
    const token = getAccessToken();
    if (!token) {
      scheduleReconnect();
      return;
    }
    controller = new AbortController();
    try {
      const response = await fetch(opts.url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: controller.signal,
        credentials: 'include',
      });
      if (response.status === 401) {
        // raw fetch 는 axios refresh 인터셉터를 안 타므로 직접 갱신 후 재연결.
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          cancelled = true; // refresh 실패 → 다음 axios 호출이 로그인으로 보냄. SSE 루프 종료.
          return;
        }
        scheduleReconnect();
        return;
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      attempt = 0;
      opts.onConnectedChange?.(true);
      opts.onOpen?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser(opts.onEvent);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      opts.onConnectedChange?.(false);
      if (!cancelled) scheduleReconnect();
    } catch (error) {
      if ((error as Error).name === 'AbortError' || cancelled) return;
      opts.onConnectedChange?.(false);
      scheduleReconnect();
    }
  };

  connect();
  return () => {
    cancelled = true;
    controller?.abort();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
