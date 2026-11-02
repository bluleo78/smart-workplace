// 변경 스트림(GET …/runner/events, SSE) — agent-runtime.changed 가 오면 조정을 깨우고, agent-runtime.screen 이면 작업 화면을 잇는다(WP-1277).
// 이벤트는 빨리 알기 위한 최선 노력일 뿐이고 정합성은 주기 조회가 맞춘다 — 그래서 끊겨도 조용히 다시 붙기만 한다.
import { WorksHttpError } from './client.js';

export interface SseEvent {
  event: string;
  data: string;
}

export interface Logger {
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

const CHANGED_EVENT = 'agent-runtime.changed';
/** 작업 화면 열기(WP-1277) — data {sessionId, agentUserId}. */
const SCREEN_EVENT = 'agent-runtime.screen';
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
/** 401 — 토큰이 재발급됐을 수 있다. 위치 화면에서 새 토큰을 Secret 에 넣을 때까지 1분 간격으로. */
const UNAUTHORIZED_RETRY_MS = 60_000;
/** 서버는 30초마다 :ping 을 보낸다. 이 시간 동안 아무 바이트도 없으면 멈춘 연결로 보고 끊은 뒤 다시 붙는다. */
const IDLE_TIMEOUT_MS = 90_000;
/** 응답 헤더를 기다리는 상한 — fetch 는 헤더 전엔 시간 제한이 없어, 막힌 프록시·반쯤 열린 연결이면 영영 붙지 않은 채 멈춘다. */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * 버퍼에서 끝난 이벤트(빈 줄로 닫힌 것)만 떼어 낸다. `:` 로 시작하는 줄(:connected·:ping)은 코멘트라 버린다.
 * rest 는 아직 덜 온 조각 — 다음 청크 앞에 붙인다.
 */
export function parseSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (event || data.length) events.push({ event: event || 'message', data: data.join('\n') });
  }
  return { events, rest };
}

export interface EventStreamOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  onChange: () => void;
  /** 작업 화면 열기(WP-1277) — data 를 JSON 으로 읽어 넘긴다(모양 검사는 받는 쪽). */
  onScreen?: (data: unknown) => void;
  /** 다시 붙기 전 기다리기 — 테스트에서 즉시로 바꾼다. */
  sleep: (ms: number) => Promise<void>;
  signal: AbortSignal;
  log: Logger;
}

/**
 * 한 번 붙어 끝날 때까지 읽는다. 정상으로 붙었는지(:connected 를 받았는지)를 돌려준다 — 백오프를 되돌릴지 정하려고.
 */
async function readOnce(opts: EventStreamOptions): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // 30초 안에 헤더가 안 오면 끊는다(실패로 다뤄 백오프 뒤 다시 붙는다). 바깥 signal(종료)도 그대로 따른다.
  const connect = new AbortController();
  const connectTimer = setTimeout(
    () => connect.abort(new Error(`변경 스트림 응답 헤더가 ${CONNECT_TIMEOUT_MS / 1000}초 안에 오지 않았습니다`)),
    CONNECT_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetchImpl(opts.url, {
      headers: { Authorization: `Bearer ${opts.token}`, Accept: 'text/event-stream' },
      signal: AbortSignal.any([opts.signal, connect.signal]),
    });
  } finally {
    clearTimeout(connectTimer);
  }
  if (!res.ok || !res.body) throw new WorksHttpError(res.status, '/events', undefined);

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';
  let connected = false;
  for (;;) {
    // 읽기와 유휴 타이머를 경주시킨다 — 타이머가 이기면 연결을 끊고 정상 종료처럼 돌려보낸다(다시 붙는 건 바깥 루프).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<'idle'>((resolve) => {
      timer = setTimeout(() => resolve('idle'), IDLE_TIMEOUT_MS);
    });
    const next = await Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
    if (next === 'idle') {
      opts.log.warn('변경 스트림에 90초 동안 아무 데이터도 없어 다시 붙습니다');
      reader.cancel().catch(() => undefined);
      break;
    }
    const { done, value } = next;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 응답이 시작되면 연결된 것으로 본다(:connected 코멘트가 첫 줄)
    connected = true;
    const { events, rest } = parseSseEvents(buffer);
    buffer = rest;
    for (const e of events) {
      if (e.event === CHANGED_EVENT) opts.onChange();
      else if (e.event === SCREEN_EVENT && opts.onScreen) {
        try {
          opts.onScreen(JSON.parse(e.data));
        } catch {
          opts.log.warn('작업 화면 이벤트를 읽지 못했습니다');
        }
      }
    }
    if (opts.signal.aborted) break;
  }
  return connected;
}

/**
 * signal 이 끊길 때까지 붙었다 끊겼다를 되풀이한다. 서버가 30분마다 닫으므로 정상 종료 뒤엔 1초 뒤 다시,
 * 연속 실패는 1→30초로 늘리고, 401 은 1분 간격.
 */
export async function runEventStream(opts: EventStreamOptions): Promise<void> {
  let backoff = BACKOFF_START_MS;
  while (!opts.signal.aborted) {
    let wait: number;
    try {
      const connected = await readOnce(opts);
      if (connected) backoff = BACKOFF_START_MS;
      wait = backoff;
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    } catch (e) {
      if (opts.signal.aborted) break;
      if (e instanceof WorksHttpError && e.status === 401) {
        opts.log.warn('변경 스트림 401 — runner 토큰이 회수됐을 수 있습니다. 1분 뒤 다시 붙습니다');
        wait = UNAUTHORIZED_RETRY_MS;
      } else {
        opts.log.warn('변경 스트림이 끊겼습니다', { error: (e as Error).message, retryMs: backoff });
        wait = backoff;
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      }
    }
    if (opts.signal.aborted) break;
    await opts.sleep(wait);
  }
}
