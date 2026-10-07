// 대화별 AI 답변 스트림 저장소(WP-190) — 여러 대화의 생성을 동시에 들고, home.chat.* 이벤트를 correlationId 로 각 대화 칸에 기록한다.
// React 바깥 모듈 상태 + useSyncExternalStore(hooks/useChatStreams) 로 구독한다. API 는 부르지 않는다(어댑터 useChatSession 담당) —
// 순수 상태라 vitest 로 검증한다. 대화를 옮겨도 칸은 그대로 살아 있어, 돌아오면 스트리밍이 이어 보인다.
import { type AiActivity, aiActivity } from '@/lib/ai/aiActivity';
import { appendDelta, appendProgress, applyDoneWidgets, applyTool, markInterrupted, toCards } from '@/lib/ai/chatTurns';
import { onAiStreamEvent } from '@/lib/aiEventBus';
import { revokeTurnPreviews, withoutTurnAttachments } from '@/lib/homeChatAttachments';
import type {
  ActiveChatItem,
  ChatTurn,
  PendingAction,
  ProposalCard,
  ToolEventDto,
  TurnAttachment,
  WidgetSpec,
} from '@/types/home';

/** 새 대화의 임시 키 접두 — POST 응답(또는 이벤트)의 sessionId 로 바뀐다. */
export const DRAFT_PREFIX = 'draft:';
/** 생성 중도 현재도 아닌 칸을 이만큼(최근 연 순서)만 들고 있는다 — 나머지는 다시 열 때 서버에서 읽는다. */
const MAX_IDLE_ENTRIES = 5;
/** 재연결 재전송을 거르기 위해 기억하는 끝난 correlationId 수. */
const MAX_FINISHED = 200;
const DEFAULT_LIMIT = 3;
const UNSEEN_KEY_PREFIX = 'ai-chat-unseen:';
const CHAT_EVENT_PREFIX = 'home.chat.';

/** 대화 목록 둘째 줄 상태 — 생성 중 / 확인 안 한 완료 / 표시 없음. */
export type SessionStatus = 'generating' | 'unseen' | null;

/** 대화 1개의 화면 상태. */
export interface StreamEntry {
  turns: ChatTurn[];
  /** 이 칸의 답변이 생성 중인가(■·3-dot). ■ 를 누르면 즉시 false — 서버 종결은 correlationId 가 남아 추적한다(R12). */
  pending: boolean;
  pendingActions: ProposalCard[];
  /** 대화별 세대 — 새 질문·■·복원마다 증가. 이전 세대의 늦은 이벤트·카드 결과를 버린다(전역 opSeq 대체). */
  gen: number;
  /**
   * 이 칸에서 아직 서버 종결을 받지 않은 생성의 correlationId — 생성 중, ■ 뒤 종결 대기(POST 응답 전 포함), 이어받은 생성(자리표시).
   * WP-267: 웹이 질문을 보낼 때 정하므로 POST 응답 전에도 있다. 종결·거절되면 null.
   */
  correlationId: string | null;
  /**
   * 서버 이력을 이 칸에 반영했는가 — 아니면 복원 때 다시 읽는다. 새 대화(draft)는 서버 이력이 없으므로 true.
   * 이력 조회가 실패한 대화에서 보낸 질문이 만든 칸은 false.
   */
  historyLoaded: boolean;
  /** WP-265: 생성 도중 SSE 가 다시 이어졌다 — 끊긴 사이 조각을 놓쳤을 수 있어 더 붙이지 않고, 끝나면 서버 이력으로 바꾼다. */
  reconnected: boolean;
}

/** 구독자에게 주는 불변 스냅샷 — 변경이 있을 때만 새 참조. */
export interface ChatStreamsSnapshot {
  entries: ReadonlyMap<string, StreamEntry>;
  currentKey: string | null;
  /** 서버 기준 생성 중 대화 sessionId → correlationId. */
  active: ReadonlyMap<string, string>;
  unseenDone: ReadonlySet<string>;
  limit: number;
  panelOpen: boolean;
  /** WP-268: 서버 이력을 읽는 중인 대화 — 그동안은 보내지 않는다(이력과 새 질문이 뒤섞이지 않게). */
  loading: ReadonlySet<string>;
  /** '새 대화' 전이 신호 — 패널이 미전송 초안을 비운다(#204). */
  newSessionNonce: number;
  /** WP-234: 실제 대화 전환(새 대화·다른 대화 선택·현재 대화 삭제) 신호 — 패널이 첨부 초안을 비운다(세션 30개 상한이 대화별). */
  attachmentResetNonce: number;
}

/**
 * correlationId → 칸. placeholder 는 중간 이벤트를 버리고 종결 때 서버 이력을 다시 읽는 생성(새로고침·다른 창에서 이어받음, SSE 재연결).
 * attached 는 서버가 이 생성을 받았음을 아는가(POST 응답·서버 목록·이벤트) — 모르면 ■ 의 취소 요청을 응답 뒤로 미룬다.
 */
interface CorrRoute {
  key: string;
  gen: number;
  placeholder: boolean;
  attached: boolean;
}

/** 저장소가 바깥에 부탁하는 부수효과 — 어댑터가 배선한다. */
export interface ChatStreamsEffects {
  sessionsChanged: () => void;
  refetch: (sessionId: string) => void;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const blank = (): StreamEntry => ({
  turns: [],
  pending: false,
  pendingActions: [],
  gen: 0,
  correlationId: null,
  historyLoaded: false,
  reconnected: false,
});

const sessionOf = (key: string | null): string | null => (key && !key.startsWith(DRAFT_PREFIX) ? key : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 저장소 생성 — 테스트는 storage 를 주입해 격리한다. 기본은 window.localStorage(접근이 막히면 null). */
export function createChatStreams(opts: { storage?: () => KeyValueStore | null } = {}) {
  const readStorage =
    opts.storage ??
    (() => {
      try {
        return typeof window === 'undefined' ? null : window.localStorage;
      } catch {
        return null;
      }
    });

  let entries = new Map<string, StreamEntry>();
  let currentKey: string | null = null;
  let active = new Map<string, string>();
  let unseenDone = new Set<string>();
  let limit = DEFAULT_LIMIT;
  let panelOpen = false;
  // 대화별 마지막 이력 조회 표식 — 앞선 조회의 끝이 뒤 조회의 잠금을 풀지 않게. 스냅샷용 집합은 바뀔 때만 새로 만든다.
  const loadingTokens = new Map<string, number>();
  let loading: ReadonlySet<string> = new Set();
  /** 이력 조회 잠금 해제 — 바뀌었으면 true. */
  function unlock(sessionId: string): boolean {
    if (!loadingTokens.delete(sessionId)) return false;
    loading = new Set(loadingTokens.keys());
    return true;
  }
  let newSessionNonce = 0;
  let attachmentResetNonce = 0;
  let ownerKey: string | null = null;
  const corrIndex = new Map<string, CorrRoute>();
  const finished = new Set<string>();
  const recent: string[] = []; // 최근 연 순서(앞이 최신)
  const activeAddedAt = new Map<string, number>(); // 로컬에서 active 에 넣은 시점(재동기화 경쟁 판정)
  let clock = 0;
  let effects: ChatStreamsEffects = { sessionsChanged: () => {}, refetch: () => {} };
  const listeners = new Set<() => void>();

  const build = (): ChatStreamsSnapshot => ({
    entries: new Map(entries),
    currentKey,
    active: new Map(active),
    unseenDone: new Set(unseenDone),
    limit,
    panelOpen,
    loading,
    newSessionNonce,
    attachmentResetNonce,
  });
  let snapshot = build();
  const commit = () => {
    snapshot = build();
    listeners.forEach((l) => l());
  };

  function loadUnseen(): Set<string> {
    if (!ownerKey) return new Set();
    try {
      const raw = readStorage()?.getItem(UNSEEN_KEY_PREFIX + ownerKey);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set(); // 읽기 실패 — 빈 상태로 시작(표시만 잃는다)
    }
  }
  function saveUnseen() {
    if (!ownerKey) return;
    try {
      readStorage()?.setItem(UNSEEN_KEY_PREFIX + ownerKey, JSON.stringify([...unseenDone]));
    } catch {
      // 저장 실패(사생활 보호 모드 등)해도 메모리 표시는 유지한다.
    }
  }

  function touchRecent(key: string) {
    const i = recent.indexOf(key);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(key);
  }

  /** 생성 중도 현재도 아닌 칸은 최근 연 순서로 MAX_IDLE_ENTRIES 개만 남긴다. */
  function prune() {
    let idle = 0;
    for (const key of [...recent]) {
      // 현재 칸은 아직 load 전(select 직후)이라 칸이 없어도 최근 목록 맨 앞 자리를 지킨다.
      if (key === currentKey) continue;
      const e = entries.get(key);
      if (!e) {
        recent.splice(recent.indexOf(key), 1);
        continue;
      }
      if (e.pending || e.correlationId || active.has(key)) continue;
      if (++idle > MAX_IDLE_ENTRIES) {
        revokeTurnPreviews(e.turns); // WP-234: 버리는 칸의 보낸 이미지 미리보기(blob:) 해제 — 다시 열면 서버 원본으로 그린다.
        entries.delete(key);
        recent.splice(recent.indexOf(key), 1);
      }
    }
  }

  /** draft 키 → sessionId. 현재 키·최근 목록·라우팅 표를 함께 옮긴다. */
  function rekey(from: string, to: string): string {
    const e = entries.get(from);
    if (!e) return to;
    entries.delete(from);
    entries.set(to, e);
    if (currentKey === from) currentKey = to;
    const i = recent.indexOf(from);
    if (i >= 0) recent[i] = to;
    for (const [cid, r] of corrIndex) if (r.key === from) corrIndex.set(cid, { ...r, key: to });
    return to;
  }

  function trackActive(sessionId: string, cid: string) {
    active.set(sessionId, cid);
    activeAddedAt.set(sessionId, ++clock);
  }
  function untrackActive(sessionId: string) {
    active.delete(sessionId);
    activeAddedAt.delete(sessionId);
  }

  /** 보고 있지 않은 대화(또는 패널이 닫힌 동안의 현재 대화)가 끝나면 "새 답변". 성공·실패·중단 구분 없음. */
  function markFinished(sessionId: string | null) {
    if (!sessionId) return;
    untrackActive(sessionId);
    if (!(panelOpen && sessionOf(currentKey) === sessionId)) {
      unseenDone.add(sessionId);
      saveUnseen();
    }
  }

  /** 끝난 correlationId 로 기억하고 라우팅을 지운다 — 이후 재전송·늦은 이벤트·재동기화 응답이 되살리지 못한다. */
  function retire(cid: string) {
    finished.add(cid);
    if (finished.size > MAX_FINISHED) finished.delete(finished.values().next().value as string);
    corrIndex.delete(cid);
  }

  function finish(cid: string, sessionId: string | null) {
    retire(cid);
    markFinished(sessionId);
  }

  /** 서버가 받지 않은 질문(409·429)의 낙관적 두 턴을 걷는다 — 남은 게 없는 draft 칸은 지운다(R17). */
  function removeOptimistic(key: string, e: StreamEntry) {
    const turns = e.turns.slice(0, -2);
    if (key.startsWith(DRAFT_PREFIX) && turns.length === 0) {
      entries.delete(key);
      if (currentKey === key) currentKey = null;
    } else entries.set(key, { ...e, turns, pending: false });
  }

  /**
   * 라우팅 표에 없는 생성의 이벤트 — 이 창이 보낸 질문은 보낼 때 등록하므로(WP-267) 다른 창이나 새로고침 전에 시작한 생성이다.
   * 종결이면 끝난 것으로 기억해 늦게 온 재동기화 응답이 되살리지 못하게 한다(WP-264). 진행 중이면 이 저장소가 아는 대화일 때만
   * 자리표시로 이어받고 이력을 다시 읽어 그 질문과 "답변 중" 을 보인다(WP-266) — SSE 는 워크스페이스 구분 없이 오므로 모르는 대화는
   * 상한·목록에 넣지 않는다(다음 재동기화가 이 워크스페이스 것만 알려 준다).
   */
  function adopt(cid: string, sid: string | null, terminal: boolean) {
    if (!sid) return;
    const e = entries.get(sid);
    if (terminal) {
      retire(cid);
      if (active.get(sid) === cid) markFinished(sid);
      if (e && !e.pending) effects.refetch(sid);
    } else {
      if (!e) return;
      trackActive(sid, cid);
      corrIndex.set(cid, { key: sid, gen: e.gen, placeholder: true, attached: true });
      if (!e.pending) effects.refetch(sid);
    }
    effects.sessionsChanged();
    commit();
  }

  /** home.chat.* 이벤트 1건 반영. */
  function applyEvent(name: string, raw: unknown) {
    const data = (raw ?? {}) as Record<string, unknown>;
    const cid = str(data.correlationId);
    if (!cid || finished.has(cid)) return;
    const sid = str(data.sessionId);
    const kind = name.slice(CHAT_EVENT_PREFIX.length);
    const terminal = kind === 'done' || kind === 'error' || kind === 'cancelled';
    const route = corrIndex.get(cid);
    if (!route) {
      adopt(cid, sid, terminal);
      return;
    }
    let key = route.key;
    if (sid && key.startsWith(DRAFT_PREFIX)) key = rekey(key, sid);
    const e = entries.get(key);
    const live = !!e && e.gen === route.gen && !route.placeholder;
    if (!terminal) {
      if (!live || !e) return; // 이전 세대·자리표시는 중간 이벤트를 버린다
      let next = e;
      if (kind === 'delta' && typeof data.text === 'string') next = { ...e, turns: appendDelta(e.turns, data.text) };
      else if (kind === 'progress' && typeof data.label === 'string') next = { ...e, turns: appendProgress(e.turns, data.label) };
      else if (kind === 'tool') next = { ...e, turns: applyTool(e.turns, data as unknown as ToolEventDto) };
      else if (kind === 'pending_action' && Array.isArray(data.actions) && data.actions.length > 0)
        next = { ...e, pendingActions: toCards(data.actions as PendingAction[]) };
      if (next === e) return; // 바뀐 게 없으면 저장·구독자 통지를 생략한다
      entries.set(key, next);
      commit();
      return;
    }
    // ■ 로 이미 로컬에서 끝낸 이전 세대의 종결(I2) — 사용자가 멈춘 생성이므로 "새 답변" 을 남기지 않는다.
    // active 는 아직 이 생성을 가리킬 때만 뺀다. 자리표시였다면 서버가 저장한 부분 답변을 다시 읽는다.
    if (e && e.gen !== route.gen) {
      retire(cid);
      const stoppedSid = sessionOf(key) ?? sid;
      if (stoppedSid && active.get(stoppedSid) === cid) untrackActive(stoppedSid);
      if (e.correlationId === cid) entries.set(key, { ...e, correlationId: null });
      if (route.placeholder && sessionOf(key)) effects.refetch(key);
      effects.sessionsChanged();
      commit();
      return;
    }
    if (e) {
      let turns = e.turns;
      if (live) {
        if (kind === 'done') turns = applyDoneWidgets(turns, data.widgets as WidgetSpec[] | null | undefined);
        // 서버 시간 초과 취소는 사용자가 멈춘 것과 구분해 "시간 초과로 중단됨"(라이브만 — 저장은 STOPPED).
        else turns = markInterrupted(turns, kind === 'error' ? 'failed' : data.reason === 'timeout' ? 'timeout' : 'stopped');
      }
      entries.set(key, { ...e, turns, pending: false, correlationId: null, reconnected: false });
      if (route.placeholder && sessionOf(key)) effects.refetch(key);
    }
    finish(cid, sessionOf(key) ?? sid);
    effects.sessionsChanged();
    commit();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    setEffects(e: ChatStreamsEffects) {
      effects = e;
    },

    /** 로그인 사용자·워크스페이스 전환 — 다른 계정의 대화·미확인 완료가 섞이지 않게 전부 비우고 새 owner 의 미확인을 읽는다. */
    setOwner(key: string | null) {
      if (key === ownerKey) return;
      ownerKey = key;
      for (const e of entries.values()) revokeTurnPreviews(e.turns); // WP-234
      entries = new Map();
      currentKey = null;
      active = new Map();
      loadingTokens.clear();
      loading = new Set();
      corrIndex.clear();
      finished.clear();
      recent.length = 0;
      activeAddedAt.clear();
      limit = DEFAULT_LIMIT;
      unseenDone = loadUnseen();
      commit();
    },

    /** 패널(사이드·풀스크린·모바일 시트) 열림 — 열면 보고 있는 현재 대화의 "새 답변" 을 해제한다. */
    setPanelOpen(open: boolean) {
      if (open === panelOpen) return;
      panelOpen = open;
      const sid = sessionOf(currentKey);
      if (open && sid && unseenDone.delete(sid)) saveUnseen();
      commit();
    },

    /** 새 대화 — 진행 중 생성은 건드리지 않고 현재 칸만 비운다. */
    newConversation() {
      currentKey = null;
      newSessionNonce++;
      attachmentResetNonce++;
      prune();
      commit();
    },

    /** 대화 선택 — 현재 칸만 바꾼다(중단 없음). 열면 확인한 것으로 본다. */
    select(key: string) {
      // WP-234: 다른 대화로 옮기면 첨부 초안을 비운다(세션 30개 상한도 대화별). 같은 대화 재선택은 초안을 지킨다.
      if (key !== currentKey) attachmentResetNonce++;
      currentKey = key;
      touchRecent(key);
      if (unseenDone.delete(key)) saveUnseen();
      prune();
      commit();
    },

    /** 칸이 있고 서버 이력도 반영됐는가 — 아니면 복원 때 다시 읽는다(그 조회가 실패한 칸 포함). */
    hasHistory: (key: string) => !!entries.get(key)?.historyLoaded,

    /** WP-268: 이력 조회 시작 — 끝날 때까지 그 대화의 전송을 막는다. 돌려준 표식으로 endLoading 한다(성공은 load 도 푼다). */
    beginLoading(sessionId: string): number {
      const token = ++clock;
      loadingTokens.set(sessionId, token);
      loading = new Set(loadingTokens.keys());
      commit();
      return token;
    },
    /** WP-268: 이력 조회 끝(실패·시간 초과 포함) — 그 뒤에 시작한 조회가 있으면 잠금을 그대로 둔다. */
    endLoading(sessionId: string, token: number) {
      if (loadingTokens.get(sessionId) === token && unlock(sessionId)) commit();
    },

    /**
     * 서버 이력으로 칸 채우기. 라이브 생성 중인 칸은 덮지 않는다(끝난 뒤 다시 열 때 읽도록 historyLoaded 는 그대로).
     * 서버 기준 생성 중이면 "답변 생성 중" 자리표시를 붙인다.
     */
    load(sessionId: string, turns: ChatTurn[], actions: PendingAction[]) {
      const unlocked = unlock(sessionId);
      const cur = entries.get(sessionId);
      const curRoute = cur?.correlationId ? corrIndex.get(cur.correlationId) : undefined;
      // 라이브 칸, 또는 재연결로 자리표시가 됐어도 POST 응답 전인 칸(덮으면 세대가 바뀌어 attach 가 ■ 로 오인해 취소한다).
      if (cur?.pending && curRoute && (!curRoute.placeholder || !curRoute.attached)) {
        if (unlocked) commit();
        return;
      }
      const cid = active.get(sessionId) ?? null;
      const gen = (cur?.gen ?? 0) + 1;
      // WP-234: 로컬 턴을 서버 이력으로 갈아끼운다 — 버리는 턴의 미리보기(blob:) 해제(서버 턴은 원본 경로로 그린다).
      if (cur) revokeTurnPreviews(cur.turns);
      entries.set(sessionId, {
        ...(cur ?? blank()),
        turns: cid ? [...turns, { role: 'assistant', content: '' }] : turns,
        pendingActions: toCards(actions),
        pending: !!cid,
        gen,
        correlationId: cid,
        historyLoaded: true,
        reconnected: false,
      });
      if (cid) corrIndex.set(cid, { key: sessionId, gen, placeholder: true, attached: true });
      if (!recent.includes(sessionId)) recent.push(sessionId);
      prune();
      commit();
    },

    /**
     * 새 질문 — 사용자 턴 + 빈 어시스턴트 턴, 세대 증가. 현재 칸이 없으면(새 대화) draft 칸을 만들어 현재로 삼는다.
     * WP-267: correlationId 를 여기서 정해 곧바로 라우팅에 올린다 — POST 응답보다 먼저 온 이벤트도 이 칸에 붙는다.
     * WP-234: attachments 는 낙관적 사용자 턴에 붙인다(미리보기 포함). 돌려준 userTurn 으로 거절 시 첨부를 뗀다(failStart).
     */
    startTurn(
      query: string,
      attachments?: TurnAttachment[],
    ): { key: string; gen: number; correlationId: string; userTurn: ChatTurn } {
      let key = currentKey;
      if (!key) {
        key = `${DRAFT_PREFIX}${crypto.randomUUID()}`;
        currentKey = key;
      }
      // 새 대화(draft)는 불러올 서버 이력이 없다. 칸 없는 기존 대화(이력 조회 실패)는 다시 열 때 읽는다.
      const e = entries.get(key) ?? { ...blank(), historyLoaded: key.startsWith(DRAFT_PREFIX) };
      const gen = e.gen + 1;
      const correlationId = crypto.randomUUID();
      const userTurn: ChatTurn = { role: 'user', content: query, ...(attachments?.length ? { attachments } : {}) };
      entries.set(key, {
        ...e,
        turns: [...e.turns, userTurn, { role: 'assistant', content: '' }],
        pending: true,
        pendingActions: [], // #351: 새 제출 — 이전 확인 카드 폐기
        gen,
        correlationId,
        reconnected: false,
      });
      corrIndex.set(correlationId, { key, gen, placeholder: false, attached: false });
      touchRecent(key);
      commit();
      return { key, gen, correlationId, userTurn };
    },

    /**
     * POST 성공 — 새 대화면 draft 키를 sessionId 로 바꾸고 서버 생성 중 목록에 넣는다.
     * serverCid 는 응답의 correlationId — 보낸 것과 다르면(웹이 정한 id 를 모르는 구 API) 라우팅을 그 id 로 옮긴다.
     * @returns 곧바로 취소해야 하는 correlationId(응답 전에 ■ 를 눌렀다), 아니면 null
     */
    attach(cid: string, serverCid: string, sessionId: string | undefined): string | null {
      const route = corrIndex.get(cid);
      // 이미 끝났다(종결 이벤트가 응답보다 먼저 왔거나 대화를 지웠다) — 되살리지 않는다.
      if (!route) return null;
      const key = sessionId && route.key.startsWith(DRAFT_PREFIX) ? rekey(route.key, sessionId) : route.key;
      if (serverCid !== cid) corrIndex.delete(cid);
      // 구 API 가 돌려준 id 의 생성이 응답보다 먼저 끝났다(이 창은 모르는 id 라 adopt 가 은퇴시켰다) — 칸만 마감한다.
      if (finished.has(serverCid)) {
        const done = entries.get(key);
        if (done?.correlationId === cid) entries.set(key, { ...done, pending: false, correlationId: null });
        commit();
        return null;
      }
      corrIndex.set(serverCid, { ...route, key, attached: true });
      const e = entries.get(key);
      if (e && serverCid !== cid && e.correlationId === cid) entries.set(key, { ...e, correlationId: serverCid });
      if (sessionId) trackActive(sessionId, serverCid);
      commit();
      return e && e.gen !== route.gen ? serverCid : null;
    },

    /**
     * POST 실패 — message 가 있으면 빈 어시스턴트 턴을 그 문구로(일반 오류), null 이면 두 턴을 걷는다(409·429 — 서버 무저장).
     * WP-234: 그 질문의 사용자 턴(userTurn, 동일성으로 찾음)에서 첨부를 뗀다 — 서버가 받지 않았으니 초안 칩이 남아 재전송되고,
     * 보낸 것처럼 보이거나 세션 30개 계산에 이중으로 잡히면 안 된다. 미리보기 URL 은 초안 소유라 해제하지 않는다.
     */
    failStart(startKey: string, gen: number, cid: string, message: string | null, userTurn?: ChatTurn) {
      // 응답 전 이벤트가 draft 키를 sessionId 로 바꿨을 수 있다 — 라우팅이 아는 현재 키를 쓴다.
      const key = corrIndex.get(cid)?.key ?? startKey;
      retire(cid);
      const found = entries.get(key);
      if (!found) return;
      let e = userTurn ? { ...found, turns: withoutTurnAttachments(found.turns, userTurn) } : found;
      if (e.correlationId === cid) e = { ...e, correlationId: null };
      if (message === null) removeOptimistic(key, e);
      // 응답 전에 ■ 한 질문(세대가 올라갔다)은 "중단됨" 표시를 그대로 둔다.
      else if (e.gen !== gen) entries.set(key, e);
      else {
        const turns = e.turns.map((t, i) =>
          i === e.turns.length - 1 && t.role === 'assistant' && t.content === '' ? { role: 'assistant' as const, content: message } : t,
        );
        entries.set(key, { ...e, turns, pending: false });
      }
      commit();
    },

    /** ■ — 이 칸의 세대를 올려 늦은 이벤트를 버리고 "중단됨" 표시. 지금 보낼 취소 대상을 돌려준다(서버가 아직 모르면 null — attach 가 취소). */
    stopLocal(key: string): string | null {
      const e = entries.get(key);
      if (!e || !e.pending) return null;
      entries.set(key, {
        ...e,
        gen: e.gen + 1,
        pending: false,
        pendingActions: [],
        turns: markInterrupted(e.turns, 'stopped'),
        reconnected: false,
      });
      commit();
      return e.correlationId && corrIndex.get(e.correlationId)?.attached ? e.correlationId : null;
    },

    /** WP-265: SSE 가 (다시) 열렸다 — 끊긴 사이 조각을 놓쳤을 수 있는 라이브 생성을 자리표시로 돌려, 끝나면 서버 이력으로 바꾼다. */
    markReconnected() {
      let changed = false;
      for (const [cid, r] of corrIndex) {
        if (r.placeholder) continue;
        const e = entries.get(r.key);
        if (!e || e.gen !== r.gen || !e.pending) continue;
        corrIndex.set(cid, { ...r, placeholder: true });
        entries.set(r.key, { ...e, reconnected: true });
        changed = true;
      }
      if (changed) commit();
    },

    /** 확인카드 상태 갱신 — 그 대화의 세대가 그대로일 때만. @returns 반영 여부 */
    patchCard(key: string, gen: number, id: number, patch: Partial<ProposalCard>): boolean {
      const e = entries.get(key);
      if (!e || e.gen !== gen) return false;
      entries.set(key, { ...e, pendingActions: e.pendingActions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
      commit();
      return true;
    },
    removeCard(key: string, gen: number, id: number): boolean {
      const e = entries.get(key);
      if (!e || e.gen !== gen) return false;
      entries.set(key, { ...e, pendingActions: e.pendingActions.filter((c) => c.id !== id) });
      commit();
      return true;
    },
    /** 확인카드 처리 결과 줄 등 턴 추가 — 세대가 그대로일 때만. */
    appendTurn(key: string, gen: number, turn: ChatTurn): boolean {
      const e = entries.get(key);
      if (!e || e.gen !== gen) return false;
      entries.set(key, { ...e, turns: [...e.turns, turn] });
      commit();
      return true;
    },

    /** 삭제된 대화 — 칸·생성 중·미확인을 지우고, 현재였다면 새 대화로. */
    forget(sessionId: string) {
      // 진행 중이던 생성의 correlationId 를 끝난 것으로 돌린다 — 늦게 온 cancelled 가 지운 대화에 "새 답변" 을 남기거나,
      // 삭제 전에 요청한 재동기화 응답이 이 대화를 active 에 되살리지 않게.
      const cids = new Set<string>();
      const activeCid = active.get(sessionId);
      if (activeCid) cids.add(activeCid);
      const entryCid = entries.get(sessionId)?.correlationId;
      if (entryCid) cids.add(entryCid);
      for (const [cid, r] of corrIndex) if (r.key === sessionId) cids.add(cid);
      cids.forEach(retire);
      revokeTurnPreviews(entries.get(sessionId)?.turns ?? []); // WP-234
      entries.delete(sessionId);
      untrackActive(sessionId);
      unlock(sessionId);
      const ri = recent.indexOf(sessionId);
      if (ri >= 0) recent.splice(ri, 1);
      if (unseenDone.delete(sessionId)) saveUnseen();
      if (currentKey === sessionId) {
        currentKey = null;
        newSessionNonce++;
        attachmentResetNonce++;
      }
      commit();
    },

    /** 세션 목록 기준 미확인 정리 — 목록이 완전할 때만(페이지 밖 세션 오삭제 방지, R15). */
    pruneUnseen(sessionIds: string[], complete: boolean) {
      if (!complete) return;
      const keep = new Set(sessionIds);
      let changed = false;
      for (const id of [...unseenDone]) if (!keep.has(id)) changed = unseenDone.delete(id) || changed;
      if (changed) {
        saveUnseen();
        commit();
      }
    },

    /** 재동기화 요청 직전 호출 — 돌려준 토큰 이후 로컬에서 시작한 생성은 응답에 없어도 지우지 않는다. */
    beginResync: () => ++clock,

    /**
     * 서버 생성 중 목록 반영. 서버에 없는 로컬 생성은 종결 이벤트를 놓친 것으로 보고 done 처럼 처리한다.
     * 이 창이 모르는 생성(새로고침 전·다른 창)은 자리표시로 이어받고, 열어 둔 칸이면 이력을 다시 읽어 "답변 중" 을 보인다.
     */
    setActive(items: ActiveChatItem[], newLimit: number, token: number) {
      limit = newLimit > 0 ? newLimit : DEFAULT_LIMIT;
      const server = new Map(items.map((i) => [i.sessionId, i.correlationId]));
      for (const [sid, cid] of [...active]) {
        if (server.has(sid) || (activeAddedAt.get(sid) ?? 0) > token) continue;
        const e = entries.get(sid);
        if (e?.correlationId === cid) entries.set(sid, { ...e, pending: false, correlationId: null, reconnected: false });
        finish(cid, sid);
        if (entries.has(sid)) effects.refetch(sid);
      }
      for (const [sid, cid] of server) {
        if (finished.has(cid)) continue;
        active.set(sid, cid);
        if (corrIndex.has(cid)) continue;
        const e = entries.get(sid);
        corrIndex.set(cid, { key: sid, gen: e?.gen ?? 0, placeholder: true, attached: true });
        if (e && !e.correlationId) effects.refetch(sid);
      }
      commit();
    },

    applyEvent,
  };
}

export type ChatStreams = ReturnType<typeof createChatStreams>;

/** 앱 전역 기본 인스턴스. */
export const chatStreams = createChatStreams();

const CHAT_EVENTS = ['delta', 'progress', 'tool', 'pending_action', 'done', 'error', 'cancelled'].map((e) => CHAT_EVENT_PREFIX + e);

/** home.chat.* 를 한 곳에서 구독해 저장소로 넘긴다(요청마다 붙였다 떼지 않는다). 반환값으로 해제. */
export function connectChatEvents(store: ChatStreams, on: typeof onAiStreamEvent = onAiStreamEvent): () => void {
  const offs = CHAT_EVENTS.map((name) => on(name, (data) => store.applyEvent(name, data)));
  return () => offs.forEach((off) => off());
}

// ── 셀렉터(순수) ─────────────────────────────────────────────────────────────

/** 현재 대화의 서버 sessionId — draft(아직 서버 미확정)면 null. */
export const currentSessionId = (s: ChatStreamsSnapshot): string | null => sessionOf(s.currentKey);

/** 대화가 생성 중인가 — 서버 기준(active) 또는 로컬 칸(구 API 처럼 sessionId 를 늦게 아는 경우). */
export const isGenerating = (s: ChatStreamsSnapshot, sessionId: string): boolean =>
  s.active.has(sessionId) || !!s.entries.get(sessionId)?.pending;

/** 목록 둘째 줄 상태. 생성 중이 새 답변보다 우선. */
export function sessionStatus(s: ChatStreamsSnapshot, sessionId: string): SessionStatus {
  if (isGenerating(s, sessionId)) return 'generating';
  return s.unseenDone.has(sessionId) ? 'unseen' : null;
}

/** except 키를 뺀 생성 중 존재 여부. */
function anyGenerating(s: ChatStreamsSnapshot, except: string | null): boolean {
  for (const sid of s.active.keys()) if (sid !== except) return true;
  for (const [k, e] of s.entries) if (e.pending && k !== except) return true;
  return false;
}

/** 진입 버튼(칩·탭바·헤더 ✦) 집계 — 패널이 열려 있으면 idle(패널 안 3-dot·목록이 담당). */
export function triggerActivityOf(s: ChatStreamsSnapshot, open: boolean): AiActivity {
  if (open) return 'idle';
  return aiActivity(anyGenerating(s, null), s.unseenDone.size > 0);
}

/** 헤더 "대화 목록" 점 — 현재 대화를 뺀 나머지의 생성 중/새 답변. */
export function otherActivity(s: ChatStreamsSnapshot): AiActivity {
  const unseen = [...s.unseenDone].some((id) => id !== s.currentKey);
  return aiActivity(anyGenerating(s, s.currentKey), unseen);
}

/** 상한 도달 — 생성 중 수 ≥ limit 이고 현재 대화가 생성 중이 아님(생성 중인 대화는 ■ 가 보인다). */
export function atLimit(s: ChatStreamsSnapshot): boolean {
  const e = s.currentKey ? s.entries.get(s.currentKey) : undefined;
  if (e?.pending) return false;
  const cur = currentSessionId(s);
  if (cur && s.active.has(cur)) return false;
  return s.active.size >= s.limit;
}

/** 전송 막힘 — 상한이거나, 이력을 읽는 중이거나(WP-268), ■ 뒤 서버 종결을 기다리거나(R12), 다른 창에서 답변 중. */
export function sendBlocked(s: ChatStreamsSnapshot): boolean {
  const e = s.currentKey ? s.entries.get(s.currentKey) : undefined;
  if (e?.pending) return false;
  if (s.currentKey && s.loading.has(s.currentKey)) return true;
  // ■ 뒤 종결 대기(POST 응답 전 포함, I3) — 막지 않으면 재전송이 409 이거나 새 대화는 서버 세션을 둘 만든다.
  if (e?.correlationId) return true;
  const cur = currentSessionId(s);
  if (cur && s.active.has(cur)) return true;
  return atLimit(s);
}

/** WP-266: 현재 대화가 이 창이 모르는 생성으로 답변 중 — 칸에 "답변 중" 표시가 아직 없을 때 입력창 위에 이유를 알린다. */
export function busyElsewhere(s: ChatStreamsSnapshot): boolean {
  const e = s.currentKey ? s.entries.get(s.currentKey) : undefined;
  if (e?.pending || e?.correlationId) return false;
  const cur = currentSessionId(s);
  return !!cur && s.active.has(cur);
}
