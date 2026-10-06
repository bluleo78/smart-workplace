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
/** 라우팅 표에 아직 없는 correlationId 의 이벤트를 보류하는 최대 수(POST 응답보다 먼저 온 이벤트). */
const MAX_ORPHANS = 100;
const DEFAULT_LIMIT = 3;
const UNSEEN_KEY_PREFIX = 'ai-chat-unseen:';
const CHAT_EVENT_PREFIX = 'home.chat.';

/** 대화 목록 둘째 줄 상태 — 생성 중 / 확인 안 한 완료 / 표시 없음. */
export type SessionStatus = 'generating' | 'unseen' | null;

/** 대화 1개의 화면 상태. */
export interface StreamEntry {
  turns: ChatTurn[];
  /** 이 칸의 답변이 생성 중인가(■·3-dot). ■ 를 누르면 즉시 false — 서버 종결은 active 가 따로 추적한다(R12). */
  pending: boolean;
  pendingActions: ProposalCard[];
  /** 대화별 세대 — 새 질문·■·복원마다 증가. 이전 세대의 늦은 이벤트·카드 결과를 버린다(전역 opSeq 대체). */
  gen: number;
  /** 이 칸에서 진행 중인 생성의 correlationId(■ 취소 대상). */
  correlationId: string | null;
  /** POST 응답 전에 ■ 를 눌렀다 — 응답이 오면 곧바로 취소한다. */
  cancelOnAttach: boolean;
  /**
   * 서버 이력을 이 칸에 반영했는가. 복원 조회가 끝나기 전에 보낸 질문이 만든 칸은 false — 늦게 온 이력을 (생성 중이어도) 앞에 붙여야
   * 지난 대화가 보인다. 새 대화(draft)는 서버 이력이 없으므로 true.
   */
  historyLoaded: boolean;
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
  /** '새 대화' 전이 신호 — 패널이 미전송 초안을 비운다(#204). */
  newSessionNonce: number;
  /** WP-234: 실제 대화 전환(새 대화·다른 대화 선택·현재 대화 삭제) 신호 — 패널이 첨부 초안을 비운다(세션 30개 상한이 대화별). */
  attachmentResetNonce: number;
}

/** correlationId → 칸. placeholder 는 새로고침 등으로 이어받은 생성(중간 이벤트는 버리고 종결 때 재조회). */
interface CorrRoute {
  key: string;
  gen: number;
  placeholder: boolean;
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
  cancelOnAttach: false,
  historyLoaded: false,
});

/**
 * 서버 이력 + 칸의 로컬 턴(이력 조회 전에 보낸 질문부터). 조회가 서버의 새 질문 저장 뒤에 처리됐으면 이력 끝에 같은 질문이 있다 —
 * 생성이 이미 끝났으면 그 답변까지 있을 수 있어(질문, 답변) 끝 두 자리까지 본다. 겹치는 부분은 로컬(라이브) 쪽을 남긴다.
 */
function mergeHistory(history: ChatTurn[], local: ChatTurn[], pending: boolean): ChatTurn[] {
  const first = local[0];
  if (first?.role === 'user') {
    const from = Math.max(0, history.length - (pending ? 1 : 2));
    for (let i = history.length - 1; i >= from; i--) {
      const t = history[i];
      if (t.role === 'user' && t.content === first.content) return [...history.slice(0, i), ...local];
    }
  }
  return [...history, ...local];
}
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
  let newSessionNonce = 0;
  let attachmentResetNonce = 0;
  let ownerKey: string | null = null;
  const corrIndex = new Map<string, CorrRoute>();
  const finished = new Set<string>();
  let orphans: { name: string; data: Record<string, unknown> }[] = [];
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
      if (e.pending || active.has(key)) continue;
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

  /** 보고 있지 않은 대화(또는 패널이 닫힌 동안의 현재 대화)가 끝나면 "새 답변". 성공·실패·중단 구분 없음. */
  function markFinished(sessionId: string | null) {
    if (!sessionId) return;
    active.delete(sessionId);
    activeAddedAt.delete(sessionId);
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

  /**
   * POST 응답(attach)을 기다리는 새 대화 draft 칸이 있는가. 있으면 서버가 먼저 알려 준 낯선 correlationId 가 그 draft 의 것일 수 있으므로,
   * 자리표시 라우팅·즉시 마감을 하지 않고 이벤트를 보류해 attach 가 순서대로(중간 → 종결) 재생하게 한다 — 그러지 않으면
   * draft 칸이 아닌 sessionId 칸으로 라우팅돼 중간 이벤트가 버려지고, 종결이 먼저 끝나 attach 뒤 영영 "생성 중" 에 갇힌다.
   */
  function draftAwaitingAttach(): boolean {
    for (const [k, e] of entries) if (k.startsWith(DRAFT_PREFIX) && e.correlationId === null && (e.pending || e.cancelOnAttach)) return true;
    return false;
  }

  /** 서버가 받지 않은 질문(409·429)의 낙관적 두 턴을 걷는다 — 남은 게 없는 draft 칸은 지운다(R17). */
  function removeOptimistic(key: string, e: StreamEntry) {
    const turns = e.turns.slice(0, -2);
    if (key.startsWith(DRAFT_PREFIX) && turns.length === 0) {
      entries.delete(key);
      if (currentKey === key) currentKey = null;
    } else entries.set(key, { ...e, turns, pending: false, cancelOnAttach: false });
  }

  function hold(name: string, data: Record<string, unknown>) {
    orphans.push({ name, data });
    if (orphans.length > MAX_ORPHANS) orphans.shift();
  }

  /** home.chat.* 이벤트 1건 반영. */
  function applyEvent(name: string, raw: unknown) {
    const data = (raw ?? {}) as Record<string, unknown>;
    const cid = str(data.correlationId);
    if (!cid || finished.has(cid)) return;
    const sid = str(data.sessionId);
    const kind = name.slice(CHAT_EVENT_PREFIX.length);
    // R6: 구 호환 error{cancelled:true} 는 home.chat.cancelled 가 대신한다.
    if (kind === 'error' && data.cancelled === true) return;
    const terminal = kind === 'done' || kind === 'error' || kind === 'cancelled';
    const route = corrIndex.get(cid);
    if (!route) {
      // 서버 active 와 일치하는 생성(다른 탭·라우팅 전 재동기화)의 종결이면 바로 마감, 그 외는 attach 를 기다린다(R16).
      if (terminal && sid && active.get(sid) === cid && !draftAwaitingAttach()) {
        finish(cid, sid);
        effects.sessionsChanged();
        commit();
      } else hold(name, data);
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
    // 라우팅만 은퇴시키고, active 가 아직 이 생성을 가리킬 때만 뺀다(■ 뒤 새 질문이 이미 active 를 차지했을 수 있다).
    if (e && e.gen !== route.gen) {
      retire(cid);
      const stoppedSid = sessionOf(key) ?? sid;
      if (stoppedSid && active.get(stoppedSid) === cid) {
        active.delete(stoppedSid);
        activeAddedAt.delete(stoppedSid);
      }
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
      entries.set(key, { ...e, turns, pending: false, correlationId: null });
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
      corrIndex.clear();
      finished.clear();
      orphans = [];
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

    /** 칸이 있고 서버 이력도 반영됐는가 — 아니면 복원 때 다시 읽는다(이력 조회 전에 보낸 질문이 만든 칸·그 조회가 실패한 칸). */
    hasHistory: (key: string) => !!entries.get(key)?.historyLoaded,

    /**
     * 서버 이력으로 칸 채우기. 라이브 생성 중인 칸은 덮지 않고, 이력 조회 전에 보낸 질문이 만든 칸엔 이력을 앞에 붙인다.
     * 서버 기준 생성 중이면 "답변 생성 중" 자리표시를 붙인다.
     */
    load(sessionId: string, turns: ChatTurn[], actions: PendingAction[]) {
      const cur = entries.get(sessionId);
      // 복원 조회 중 보낸 질문이 만든 칸(아직 이력 없음, 낙관적 턴만) — POST 응답 전이든(attach 대기) 응답이 먼저 와 생성 중이든(라이브),
      // 이미 끝났든. 덮어쓰거나 세대를 올리면 attach·라이브 라우팅이 그 세대로 이벤트를 받지 못해 질문·답변이 사라진 채 "생성 중" 에 갇히고,
      // 건너뛰면 지난 대화가 이 브라우저 세션 동안 안 보인다(칸이 있으니 다시 열어도 재조회하지 않는다, R14) — 세대·correlationId·
      // ■ 예약은 그대로 두고 서버 이력을 앞에 붙인다.
      if (cur && !cur.historyLoaded && cur.turns.length > 0) {
        entries.set(sessionId, { ...cur, turns: mergeHistory(turns, cur.turns, cur.pending), historyLoaded: true });
        commit();
        return;
      }
      const curRoute = cur?.correlationId ? corrIndex.get(cur.correlationId) : undefined;
      if (cur?.pending && curRoute && !curRoute.placeholder) return;
      // 이력이 이미 반영된 칸의 attach 대기(새 질문 POST 진행 중) — 로컬이 서버보다 앞서 있다. 덮으면 attach 가 세대를 잃고,
      // 붙이면 이력이 두 번 보인다. POST 가 끝나면(attach·failStart) 이후 조회가 정상 경로를 탄다.
      if (cur && cur.correlationId === null && (cur.pending || cur.cancelOnAttach)) return;
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
        cancelOnAttach: false,
        historyLoaded: true,
      });
      if (cid) corrIndex.set(cid, { key: sessionId, gen, placeholder: true });
      if (!recent.includes(sessionId)) recent.push(sessionId);
      prune();
      commit();
    },

    /**
     * 새 질문 — 사용자 턴 + 빈 어시스턴트 턴, 세대 증가. 현재 칸이 없으면(새 대화) draft 칸을 만들어 현재로 삼는다.
     * WP-234: attachments 는 낙관적 사용자 턴에 붙인다(미리보기 포함). 돌려준 userTurn 으로 거절 시 첨부를 뗀다(failStart).
     */
    startTurn(query: string, attachments?: TurnAttachment[]): { key: string; gen: number; userTurn: ChatTurn } {
      let key = currentKey;
      if (!key) {
        key = `${DRAFT_PREFIX}${crypto.randomUUID()}`;
        currentKey = key;
      }
      // 새 대화(draft)는 불러올 서버 이력이 없다. 칸 없는 기존 대화(복원 조회 중)는 이력이 아직이다 — load 가 앞에 붙인다.
      const e = entries.get(key) ?? { ...blank(), historyLoaded: key.startsWith(DRAFT_PREFIX) };
      const gen = e.gen + 1;
      const userTurn: ChatTurn = { role: 'user', content: query, ...(attachments?.length ? { attachments } : {}) };
      entries.set(key, {
        ...e,
        turns: [...e.turns, userTurn, { role: 'assistant', content: '' }],
        pending: true,
        pendingActions: [], // #351: 새 제출 — 이전 확인 카드 폐기
        gen,
        correlationId: null,
        // ■ 뒤 POST 응답을 기다리는 취소 예약은 지우지 않는다(I3) — 지우면 멈춘 생성이 서버에서 끝까지 돈다.
        // 예약은 그 POST 가 끝날 때(attach·failStart) 정리된다. 평소엔 sendBlocked 가 이 경로 자체를 막는다.
        cancelOnAttach: e.cancelOnAttach,
      });
      touchRecent(key);
      commit();
      return { key, gen, userTurn };
    },

    /**
     * POST 성공 — 새 대화면 draft 키를 sessionId 로 바꾸고 correlationId 를 등록해 이벤트를 받는다. 보류된 이벤트를 재생한다.
     * @returns 바뀐 키 + 곧바로 취소해야 하는지(응답 전 ■)
     */
    attach(key: string, gen: number, correlationId: string, sessionId: string | undefined): { key: string; cancelNow: boolean } {
      const k = sessionId && key.startsWith(DRAFT_PREFIX) ? rekey(key, sessionId) : key;
      if (finished.has(correlationId)) {
        // 안전망: 이미 끝난 생성(이벤트를 받을 길이 없다) — active 에 되살리지 않고 칸만 마감해 "생성 중" 에 갇히지 않게 한다.
        const done = entries.get(k);
        if (done && done.gen === gen) entries.set(k, { ...done, pending: false, correlationId: null, cancelOnAttach: false });
        else if (done && done.cancelOnAttach && gen < done.gen) entries.set(k, { ...done, cancelOnAttach: false }); // 멈춘 POST 의 예약 정리
        if (sessionId && active.get(sessionId) === correlationId) active.delete(sessionId);
        commit();
        return { key: k, cancelNow: false };
      }
      if (sessionId) {
        active.set(sessionId, correlationId);
        activeAddedAt.set(sessionId, ++clock);
      }
      corrIndex.set(correlationId, { key: k, gen, placeholder: false });
      const e = entries.get(k);
      let cancelNow = false;
      if (e) {
        // 취소 예약은 ■ 로 세대가 올라간 "이전" POST 의 것이다(stopLocal 이 세대를 올린다) — 그 POST 의 응답일 때만 소비한다.
        // 같은 세대(■ 뒤 새 질문)의 응답이면 예약을 남겨 이전 POST 의 attach·failStart 가 처리하게 한다.
        cancelNow = e.cancelOnAttach && gen < e.gen;
        entries.set(k, {
          ...e,
          correlationId: e.gen === gen ? correlationId : e.correlationId,
          cancelOnAttach: e.cancelOnAttach && !cancelNow,
        });
      }
      const mine = orphans.filter((o) => o.data.correlationId === correlationId);
      orphans = orphans.filter((o) => o.data.correlationId !== correlationId);
      commit();
      mine.forEach((o) => applyEvent(o.name, o.data));
      return { key: k, cancelNow };
    },

    /**
     * POST 실패 — message 가 있으면 빈 어시스턴트 턴을 그 문구로(일반 오류), null 이면 두 턴을 걷는다(409·429 — 서버 무저장).
     * WP-234: 턴이 남는 경우 그 질문의 사용자 턴(userTurn, 동일성으로 찾음)에서 첨부를 뗀다 — 서버가 받지 않았으니 초안 칩이 남아
     * 재전송되고, 보낸 것처럼 보이거나 세션 30개 계산에 이중으로 잡히면 안 된다. 미리보기 URL 은 초안 소유라 해제하지 않는다.
     */
    failStart(key: string, gen: number, message: string | null, userTurn?: ChatTurn) {
      const found = entries.get(key);
      if (!found) return;
      const e = userTurn ? { ...found, turns: withoutTurnAttachments(found.turns, userTurn) } : found;
      // 응답 전에 ■ 한 POST 의 실패(I1) — stopLocal 이 세대를 올렸어도 정리는 해야 한다. 취소 예약을 지우지 않으면 draft 가
      // 영영 attach 대기로 남아(draftAwaitingAttach) 재동기화·종결을 막고, 기존 대화는 이후 load 마다 이력을 중복으로 붙인다.
      if (e.gen !== gen) {
        if (!(e.cancelOnAttach && e.correlationId === null && gen < e.gen)) {
          // 세대가 바뀌었어도(■·새 질문 뒤 늦은 거절) 거절된 질문의 첨부는 뗀다(WP-234) — 세대 대신 턴 동일성으로 찾았다.
          if (e.turns !== found.turns) {
            entries.set(key, e);
            commit();
          }
          return;
        }
        // ■ 뒤 새 질문이 없으면(세대가 ■ 한 번만큼만 올랐으면) 거절 시 낙관적 두 턴도 걷는다(R17). 일반 오류면 "중단됨" 표시를 그대로 둔다.
        if (message === null && e.gen === gen + 1) removeOptimistic(key, e);
        else entries.set(key, { ...e, cancelOnAttach: false });
        commit();
        return;
      }
      if (message !== null) {
        const turns = e.turns.map((t, i) =>
          i === e.turns.length - 1 && t.role === 'assistant' && t.content === '' ? { role: 'assistant' as const, content: message } : t,
        );
        entries.set(key, { ...e, turns, pending: false });
      } else removeOptimistic(key, e);
      commit();
    },

    /** ■ — 이 칸의 세대를 올려 늦은 이벤트를 버리고 "중단됨" 표시. 서버 취소 대상 correlationId 를 돌려준다(없으면 attach 때 취소). */
    stopLocal(key: string): string | null {
      const e = entries.get(key);
      if (!e || !e.pending) return null;
      entries.set(key, {
        ...e,
        gen: e.gen + 1,
        pending: false,
        pendingActions: [],
        turns: markInterrupted(e.turns, 'stopped'),
        correlationId: null,
        cancelOnAttach: e.correlationId === null,
      });
      commit();
      return e.correlationId;
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
      orphans = orphans.filter((o) => !cids.has(o.data.correlationId as string));
      entries.delete(sessionId);
      active.delete(sessionId);
      activeAddedAt.delete(sessionId);
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

    /** 서버 생성 중 목록 반영. 서버에 없는 로컬 생성은 종결 이벤트를 놓친 것으로 보고 done 처럼 처리한다. */
    setActive(items: ActiveChatItem[], newLimit: number, token: number) {
      limit = newLimit > 0 ? newLimit : DEFAULT_LIMIT;
      const server = new Map(items.map((i) => [i.sessionId, i.correlationId]));
      for (const [sid, cid] of [...active]) {
        if (server.has(sid) || (activeAddedAt.get(sid) ?? 0) > token) continue;
        const e = entries.get(sid);
        if (e?.pending) entries.set(sid, { ...e, pending: false, correlationId: null });
        finish(cid, sid);
        if (entries.has(sid)) effects.refetch(sid);
      }
      for (const [sid, cid] of server) {
        if (finished.has(cid)) continue;
        active.set(sid, cid);
        // attach 를 기다리는 draft 가 있으면 낯선 생성에 자리표시 라우팅을 걸지 않는다(draftAwaitingAttach 참고) — attach 가 소유한다.
        // active 에는 넣어 상한 집계는 서버 기준을 따른다. draft 의 것이 아니었다면 다음 재동기화가 자리표시를 건다.
        if (!corrIndex.has(cid) && !draftAwaitingAttach())
          corrIndex.set(cid, { key: sid, gen: entries.get(sid)?.gen ?? 0, placeholder: true });
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

/** 전송 막힘 — 상한이거나, ■ 뒤 서버 종결을 기다리는 중(R12). */
export function sendBlocked(s: ChatStreamsSnapshot): boolean {
  const e = s.currentKey ? s.entries.get(s.currentKey) : undefined;
  if (e?.pending) return false;
  // POST 응답 전에 ■ 한 칸(I3) — 아직 active 에 없어도 그 POST 가 끝날(attach·failStart) 때까지 막는다.
  // 막지 않으면 재전송이 기존 대화는 409, 새 대화는 서버 세션을 둘 만들고 멈춘 생성이 끝까지 돈다.
  if (e && e.correlationId === null && e.cancelOnAttach) return true;
  const cur = currentSessionId(s);
  if (cur && s.active.has(cur)) return true;
  return atLimit(s);
}
