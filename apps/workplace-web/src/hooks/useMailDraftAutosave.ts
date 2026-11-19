// 메일 작성창 자동 임시저장(WP-577) — 내용이 바뀌면 1.5초 뒤 저장(첫 저장 POST, 이후 PUT+version).
// 저장은 작성(instanceId) 하나에 묶인 세션 객체에 이어 붙인다(chain) — 첫 POST 가 끝나기 전에 바뀌어도 id 를 받은 뒤 PUT 해
// 임시저장이 둘로 생기지 않고, 다른 작성으로 바뀐 뒤 늦게 끝난 저장이 새 작성의 id·버전을 덮지 않는다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createMailDraft, deleteMailDraft, updateMailDraft } from '@/api/mailDrafts';
import { invalidateMailDrafts } from '@/hooks/queries/mailDraftKeys';
import { mailDraftQuery, patchMailDraftRow } from '@/hooks/queries/useMailDrafts';
import { extractApiError, extractApiErrorCode, isConflictError, isNotFoundError } from '@/lib/api-error';
import { isSendInFlight } from '@/lib/mailDraftCompose';
import { DRAFT_CONFLICT, DRAFT_NOT_FOUND, DRAFT_SENDING, type MailDraftSaveRequest } from '@/types/mailDraft';

/** 내용이 바뀐 뒤 저장까지 기다리는 시간. */
export const DRAFT_AUTOSAVE_DELAY_MS = 1500;

/**
 * 다른 곳에서 보내는 중(inflight)인 임시저장을 다시 확인하는 간격(WP-1786 코드 리뷰) — 다른 탭이 「되돌리기」로 대기를 풀었거나 대기열이 보내지 못해
 * 임시보관으로 돌려놓으면 이 작성창이 영영 잠겨 있지 않게 한다. 대기열 회차(5초)와 같은 간격이고, 창으로 돌아올 때(탭이 다시 보일 때)도 바로 본다.
 */
export const DRAFT_INFLIGHT_RECHECK_MS = 5000;

/**
 * 저장 상태 — idle(저장할 것 없음) / pending(바뀜, 디바운스 대기) / saving / saved /
 * error(네트워크·5xx·계정 404 등 — 다시 시도) / invalid(400 검증 — 원인을 보이고 같은 내용으로는 다시 시도하지 않는다) /
 * conflict(409 — 다른 곳에서 먼저 고침) /
 * gone(404 DRAFT_NOT_FOUND — 다른 곳에서 보냈거나 버림. 되살리지 않고 자동 저장을 멈춘다. 작성창은 남아 여기서 보낼 수 있다) /
 * inflight(409 DRAFT_SENDING, WP-1786 — 이 임시저장이 다른 탭·창에서 보내기 대기열에 올라 보내는 중. 자동 저장도 보내기도 멈춘다 —
 * 여기서 또 보내면 같은 메일이 두 번 나가므로 id 를 그대로 두고 보내기를 막는다. 끝이 아니라 잠시 멈춤이다 — 서버를 다시 확인해 대기가 풀렸으면
 * 충돌(conflict)로 넘어가 이어 쓸 수 있고, 보내고 지워졌으면 gone 이 된다. 이 창에서 저장하지 못한 변경은 inflightUnsaved 로 따로 알린다).
 */
export type DraftSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'invalid' | 'conflict' | 'gone' | 'inflight';

/**
 * 저장하지 않은 변경이 남은 상태 — 새로고침·탭 닫기 경고 대상. inflightUnsaved 는 다른 곳에서 보내는 중(inflight)으로 멈추며 저장하지 못한 변경이
 * 남았는가(훅의 inflightUnsaved) — inflight 그 자체는 저장할 것이 없지만, 그 변경은 닫을 때 새 임시저장으로 남기므로 경고 대상이다(WP-1786 코드 리뷰).
 */
export function hasUnsavedDraft(status: DraftSaveStatus, inflightUnsaved = false): boolean {
  if (status === 'inflight') return inflightUnsaved;
  return status === 'pending' || status === 'saving' || status === 'error' || status === 'invalid' || status === 'conflict';
}

/**
 * 400 검증 오류 문구를 저장 상태 줄에 맞게 줄인다 — 첫 문장만(「첨부 파일을 찾을 수 없어요. 만료됐을 수 있으니 …」 → 「첨부 파일을 찾을 수 없어요」).
 * 문구가 없으면 일반 안내.
 */
export function shortSaveReason(message: string): string {
  const first = message.split(/(?<=[.。!?])\s+/)[0].replace(/[.。]$/, '').trim();
  return first || '내용을 확인해 주세요';
}

/** 작성창이 넘기는 지금 내용 — empty 면(빈 새 메일) 저장하지 않는다(이미 저장된 임시저장이면 비워진 것도 저장한다). */
export interface DraftSnapshot {
  payload: MailDraftSaveRequest;
  empty: boolean;
}

/**
 * 세션 단계 — active(정상) / error(네트워크·5xx — 다시 시도) / invalid(400 — 고쳐야 풀림) / conflict(409 — 서버 내용을 덮지 않음) /
 * gone(404 — 다른 곳에서 보냈거나 버림, 이후 저장 안 함) / inflight(409 DRAFT_SENDING — 다른 곳에서 보내는 중, 저장·보내기 멈춤. 다시 확인해
 * 대기가 풀리면 conflict, 보내고 지워졌으면 gone 으로 넘어간다) / ended(보냈거나 버림·다시 불러오기 — 이후 저장 안 함).
 * 한 값이라 앞 실패가 뒤 상태에 남지 않는다(예: 검증 오류 뒤 네트워크 오류면 「다시 시도」가 산다).
 */
type SessionPhase = 'active' | 'error' | 'invalid' | 'conflict' | 'gone' | 'inflight' | 'ended';

/**
 * 자동 저장이 멈춘 단계인가 — ended·gone 은 끝이고, inflight 는 다른 곳에서 보내는 동안의 잠시 멈춤이다(다시 확인해 풀리면 conflict 로 넘어간다).
 * 멈춘 동안의 입력은 저장하지 않고 dirty 로만 남긴다(inflight 면 닫을 때 새 임시저장으로 남긴다 — flushSession).
 */
function isStopped(phase: SessionPhase): boolean {
  return phase === 'ended' || phase === 'gone' || phase === 'inflight';
}

/** 단계가 화면에 그대로 보이는 상태 — active·ended 는 저장 흐름(pending·saving·saved·idle)이 정한다. */
const PHASE_STATUS: Partial<Record<SessionPhase, DraftSaveStatus>> = {
  error: 'error',
  invalid: 'invalid',
  conflict: 'conflict',
  gone: 'gone',
  inflight: 'inflight',
};

/** 작성 하나의 저장 세션. 화면 상태가 아니라서 ref 로 들고, 상태 표시는 지금 세션일 때만 바꾼다. */
interface Session {
  instanceId: number;
  id: number | null;
  version: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** 저장하지 않은 변경이 있다. */
  dirty: boolean;
  /** 저장 요청을 차례로 잇는 사슬 — 늘 성공으로 끝나는 promise(실패는 phase 로 남긴다). */
  chain: Promise<void>;
  /** 이 세션에서 한 번이라도 저장했는가 — ✕ 로 닫을 때 「임시보관함에 저장했어요」를 띄울지. */
  wrote: boolean;
  phase: SessionPhase;
  /** 보내는 중 — 자동 저장·닫을 때 저장을 멈춘다(보내면 서버가 임시저장을 지우므로 그 사이 저장이 새 임시저장을 만들지 않게). */
  sending: boolean;
  /**
   * 이 세션이 마지막으로 읽은 자기 내용 — 보내는 동안 작성창이 닫히거나 다른 작성으로 바뀌면 화면의 내용은 더는 이 세션 것이 아니다.
   * 그 뒤 보내기가 실패하면 이 내용으로만 저장한다(다른 작성의 내용·빈 계정으로 저장하지 않게).
   */
  snap: DraftSnapshot | null;
  /** invalid(400)의 원인 문구 — flush 결과에 실어 호출부가 실제 사유를 알린다(새 창으로 열기 실패, WP-1535). */
  reason?: string;
}

function newSession(instanceId: number, id: number | undefined, version: number | undefined, dirty: boolean): Session {
  return { instanceId, id: id ?? null, version: version ?? null, timer: null, dirty, chain: Promise.resolve(), wrote: false, phase: 'active', sending: false, snap: null };
}

/** 기다리던 저장 타이머를 멈춘다. */
function stopTimer(s: Session) {
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}

/** 이후 저장하지 않는다(보냈다·버렸다·다시 불러온다). ended 는 보이는 상태가 없어 setPhase 를 거치지 않는다. */
function endSession(s: Session) {
  stopTimer(s);
  s.sending = false;
  s.phase = 'ended';
}

/** 409 — 다른 탭·기기가 먼저 저장해 버전이 어긋났다(ErrorResponse.errors.code = DRAFT_CONFLICT). 코드가 없어도 이 자원의 409 는 버전 충돌뿐이다. */
function isConflict(e: unknown): boolean {
  if (!axios.isAxiosError(e) || e.response?.status !== 409) return false;
  const code = extractApiErrorCode(e);
  return code == null || code === DRAFT_CONFLICT;
}

/**
 * 404 DRAFT_NOT_FOUND — 그 임시저장이 없어졌다(다른 탭·기기에서 버렸거나 보냈다). 계정이 비활성인 404 같은 다른 404 는 코드가 없어
 * 일반 저장 실패로 다룬다.
 */
function isDraftGone(e: unknown): boolean {
  return isNotFoundError(e) && extractApiErrorCode(e) === DRAFT_NOT_FOUND;
}

/**
 * 409 DRAFT_SENDING(WP-1786) — 그 임시저장이 보내기 대기열에 올라 보내는 중이다(다른 탭·창에서 보냈다). 고치지 못하는 것이 맞으므로
 * 오류로 다루지 않고 inflight 로 멈춘다. 없어진 것(gone)과 달리 id 를 비우지 않는다 — 비우면 이 창의 보내기가 draftId 없이 새 대기 행을
 * 만들어 같은 메일이 두 번 나간다(코드 리뷰). 작성창도 보내기를 막는다.
 */
export function isDraftSending(e: unknown): boolean {
  return isConflictError(e) && extractApiErrorCode(e) === DRAFT_SENDING;
}

/** 400 — 요청 검증 실패(상한 초과·쓸 수 없는 첨부). 같은 내용으로 다시 보내도 같은 결과다. */
function isInvalid(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 400;
}

/** 보내기 손잡이 — beginSend 가 그 작성의 세션에 묶어 돌려준다(보내는 동안 작성창이 닫히거나 바뀌어도 그 세션을 다룬다). */
export interface DraftSendTicket {
  /** 이어받은 임시저장 id — 발송 요청 draftId(없거나 없어졌거나 충돌 중이면 undefined). */
  draftId: number | undefined;
  /** 보냈다 — 서버가 임시저장을 지웠으므로 이후 저장하지 않는다. */
  succeeded: () => void;
  /**
   * 보내지 못했다. 작성창이 그대로면 자동 저장을 다시 켜고 null(검증 오류면 그대로 둔다).
   * 작성창이 닫혔거나 다른 작성으로 바뀌었으면 이 작성의 내용을 바로 저장하고 그 결과(promise)를 돌려준다 — 호출부가 「보내지 못해 임시보관함에 저장했어요」로 알린다.
   */
  failed: () => Promise<DraftFlushResult> | null;
  /**
   * 서버가 409 DRAFT_SENDING 으로 거절했다(WP-1786) — 이 임시저장은 다른 곳에서 이미 보내는 중이다. 이 작성의 저장·보내기를 멈춘다(inflight).
   * 다시 저장하지 않는다 — 저장하면 대기 행을 고치려다 또 409 이고, 닫힌 작성이면 새 임시저장이 생겨 보낸 메일이 임시보관함에 하나 더 남는다.
   */
  alreadySending: () => void;
}

interface Options {
  /** 지금 작성 인스턴스 — 없으면(작성창 닫힘) 아무것도 하지 않는다. */
  instanceId: number | undefined;
  /** 임시보관함에서 연 작성이면 그 id·버전. */
  initialDraftId?: number;
  initialVersion?: number;
  /**
   * 처음부터 저장 안 된 내용인가 — 저장에 실패해 「다시 열기」로 연 작성. 열자마자 1.5초 뒤 저장을 다시 시도하고(새 메일은 POST, 기존 임시저장은 PUT),
   * 그냥 닫아도 저장한다.
   */
  initialUnsaved?: boolean;
  accountId: number | undefined;
  /** 지금 내용. 호출 시점에 읽는다(본문은 ref 라 렌더 값이 아니다). */
  getSnapshot: () => DraftSnapshot;
  /** 첫 저장으로 id 를 받았을 때 — 컨텍스트에 묶어 같은 임시저장을 다시 열 때 알아보게. */
  onCreated: (instanceId: number, draftId: number) => void;
  /**
   * 다른 곳에서 보내던(inflight) 이 임시저장의 보내기가 풀렸고(되돌렸거나 보내지 못했다) 이 창에 저장하지 못한 변경이 없다(WP-1786 코드 리뷰) —
   * 호출부가 서버 내용으로 다시 연다(충돌 「다시 불러오기」와 같은 길). 그 전까지 상태는 충돌이라, 다시 열지 못해도 「다시 불러오기」가 남는다.
   */
  onSendReleased?: (draftId: number) => void;
}

/**
 * flush 결과 — wrote: 이번 세션에서 서버에 저장했다, ok: 마지막 저장이 성공했다,
 * draftId·version: 서버의 임시저장(없으면 null) — 실패 뒤 「다시 열기」가 같은 임시저장을 이어 PUT 하게.
 */
export interface DraftFlushResult {
  wrote: boolean;
  ok: boolean;
  draftId: number | null;
  version: number | null;
  /** 검증 오류(400)로 저장하지 못했으면 그 사유(짧은 문구). */
  reason?: string;
}

/**
 * 작성창 자동 임시저장 훅. 작성창은 내용이 바뀔 때 schedule, 닫을 때 flush, 보낼 때 beginSend(→ 손잡이 succeeded·failed), 버릴 때 discard 를 부른다.
 * 저장 실패는 다음 입력·다시 시도에 다시 실리고, 409 충돌이면 서버 내용을 덮지 않고 멈춘다(다시 불러오기·닫을 때 새 임시저장으로 남기기).
 * 404 면 다른 곳에서 보냈거나 버린 것이라 되살리지 않고 멈춘다(gone).
 */
export function useMailDraftAutosave({
  instanceId,
  initialDraftId,
  initialVersion,
  initialUnsaved,
  accountId,
  getSnapshot,
  onCreated,
  onSendReleased,
}: Options) {
  const qc = useQueryClient();
  // 상태는 작성(instanceId)에 묶어 둔다 — 새 작성으로 바뀌면 effect 없이 렌더 중에 처음 상태(임시보관함에서 열면 저장됨, 다시 열기면 저장 중…)로 보인다.
  // unsaved: inflight 로 멈추며 저장하지 못한 변경이 남았다(상태 줄 안내·나가기 경고).
  // draftId: inflight 일 때 다시 확인할 임시저장 id — 세션은 ref 라 렌더 중에 읽지 않고 상태로 함께 든다.
  const [shown, setShown] = useState<{
    instanceId: number;
    status: DraftSaveStatus;
    reason?: string;
    unsaved?: boolean;
    draftId?: number | null;
  } | null>(null);
  const current = instanceId != null && shown?.instanceId === instanceId ? shown : null;
  const status: DraftSaveStatus =
    instanceId == null ? 'idle' : current ? current.status : initialUnsaved ? 'pending' : initialDraftId != null ? 'saved' : 'idle';
  /** invalid 의 원인(짧은 문구). */
  const statusReason = current?.reason;
  /** inflight 로 멈추며 이 창에서 저장하지 못한 변경이 남았는가(WP-1786 코드 리뷰) — 닫을 때 새 임시저장으로 남기고, 그 전엔 나가기를 경고한다. */
  const inflightUnsaved = status === 'inflight' && !!current?.unsaved;
  const session = useRef<Session | null>(null);
  // 최신 콜백 — 타이머·사슬이 렌더 클로저가 아니라 지금 값을 읽게.
  const latest = useRef({ getSnapshot, onCreated, accountId, onSendReleased });
  useLayoutEffect(() => {
    latest.current = { getSnapshot, onCreated, accountId, onSendReleased };
  });

  /**
   * 지금 세션의 상태만 화면에 반영한다(바뀐 뒤 늦게 끝난 앞 작성의 저장이 새 작성 표시를 바꾸지 않게).
   * 같은 상태면 이전 값을 그대로 둬 입력마다 다시 그리지 않는다.
   */
  const show = useCallback((s: Session, next: DraftSaveStatus, reason?: string) => {
    if (session.current !== s) return;
    // inflight 의 저장 못 한 변경 여부는 세션에서 읽는다 — 멈춘 뒤 입력(schedule)이 같은 inflight 로 다시 보여 안내를 바꾼다.
    const unsaved = next === 'inflight' && s.dirty;
    // inflight 면 다시 확인할 임시저장 id 도 싣는다(inflight 동안 id 는 바뀌지 않는다).
    const draftId = next === 'inflight' ? s.id : undefined;
    setShown((prev) =>
      prev?.instanceId === s.instanceId &&
      prev.status === next &&
      prev.reason === reason &&
      !!prev.unsaved === unsaved &&
      prev.draftId === draftId
        ? prev
        : { instanceId: s.instanceId, status: next, reason, unsaved, draftId },
    );
  }, []);

  /** 단계를 바꾸고, 화면에 보이는 단계면 함께 보인다 — 단계는 늘 여기서만 바꿔 표시와 어긋나지 않게. */
  const setPhase = useCallback(
    (s: Session, phase: SessionPhase, reason?: string) => {
      s.phase = phase;
      s.reason = phase === 'invalid' ? reason : undefined;
      const status = PHASE_STATUS[phase];
      if (status) show(s, status, reason);
    },
    [show],
  );

  /**
   * 404 DRAFT_NOT_FOUND — 그 임시저장이 없어졌다(다른 곳에서 보냈거나 버렸다). 저장 실패와 inflight 다시 확인이 같이 쓴다.
   * 되살리지 않고 gone 으로 멈추며, id 를 비워 이 창의 보내기가 없는 draftId 를 싣지 않게(새 메일로 나가게) 한다.
   * 임시보관함 목록·개수에 남은 그 줄도 걷어낸다 — 남겨 두면 눌러도 열리지 않는 줄이 된다.
   */
  const markGone = useCallback(
    (s: Session, accountId: number | undefined) => {
      s.id = null;
      s.version = null;
      s.dirty = false;
      setPhase(s, 'gone');
      if (accountId != null) void invalidateMailDrafts(qc, accountId);
    },
    [qc, setPhase],
  );

  /**
   * 세션의 변경을 지금 저장 사슬에 잇는다. 결과 promise 는 이 저장까지 끝나면 풀린다.
   * saveEmpty 면 빈 새 메일(손대지 않은 새 메일·답장·전달)도 만든다 — 새 창으로 열 때(WP-1535) 열 임시저장 id 가 있어야 해서.
   */
  const save = useCallback(
    (s: Session, saveEmpty = false): Promise<DraftFlushResult> => {
      stopTimer(s);
      // 화면의 내용은 지금 세션일 때만 이 세션 것이다 — 보내는 중에 닫거나 바꾸는 순간의 내용도 여기서 잡아 둔다.
      const own = session.current === s;
      if (own && s.sending) s.snap = latest.current.getSnapshot();
      // 없어진 임시저장은 저장한 것이 없는 것으로 알린다 — 닫을 때 「임시보관함에 저장했어요」를 띄우지 않는다.
      // 보내는 중에 닫으면 저장하지 않고 알리지도 않는다(보내기가 결과를 알린다).
      // inflight 의 남은 변경은 flushSession 이 새 임시저장으로 돌린 뒤라 여기 오는 inflight 는 저장할 것이 없다.
      const result = (): DraftFlushResult =>
        s.phase === 'gone' || s.phase === 'inflight' || s.sending
          ? { wrote: false, ok: true, draftId: null, version: null }
          : {
              wrote: s.wrote,
              ok: s.phase !== 'error' && s.phase !== 'conflict' && s.phase !== 'invalid',
              draftId: s.id,
              version: s.version,
              reason: s.phase === 'invalid' ? s.reason : undefined,
            };
      const stopped = () => isStopped(s.phase) || s.sending;
      if (!s.dirty || stopped() || s.phase === 'conflict') return s.chain.then(result);
      // 내용은 지금 읽는다 — 사슬이 기다리는 동안 작성이 바뀌어도 이 시점의 내용이 저장된다. 떨어진 세션은 잡아 둔 자기 내용만 쓴다.
      const snap = own ? latest.current.getSnapshot() : s.snap;
      if (!snap) return s.chain.then(result);
      s.snap = snap;
      s.dirty = false;
      if (snap.empty && s.id == null && !saveEmpty) {
        show(s, 'idle');
        return s.chain.then(result);
      }
      show(s, 'saving');
      s.chain = s.chain.then(async () => {
        if (stopped()) {
          // 보내는 동안 미뤄진 저장 — 보내기가 실패하면 failed() 가 다시 저장하도록 변경을 남긴다.
          if (s.sending) s.dirty = true;
          return;
        }
        try {
          // 첫 저장은 POST(만들기), 이후는 PUT+version. id 는 사슬 안에서 읽어 앞 POST 가 끝난 뒤의 값을 쓴다.
          // 업로드가 내 다른 임시저장에 묶여 있으면(충돌 뒤 새로 남기기) 서버가 이 임시저장으로 옮겨 묶는다.
          if (s.id == null) {
            const r = await createMailDraft(snap.payload);
            s.id = r.id;
            s.version = r.version;
            latest.current.onCreated(s.instanceId, r.id);
            // 만들면 목록·개수가 바뀐다.
            void invalidateMailDrafts(qc, snap.payload.accountId);
          } else {
            const r = await updateMailDraft(s.id, { ...snap.payload, version: s.version ?? undefined });
            s.version = r.version;
            // 고치면 개수는 그대로다 — 목록의 그 줄만 고쳐 다시 받지 않는다.
            patchMailDraftRow(qc, s.id, snap.payload, r);
          }
          s.wrote = true;
          if (s.phase === 'error' || s.phase === 'invalid') setPhase(s, 'active');
          // 그사이 또 바뀌었으면 다음 저장이 곧 오므로 「저장 중…」을 유지한다.
          if (!s.dirty) show(s, 'saved');
        } catch (e) {
          // 그사이 버렸으면(discard) 결과를 덮어쓰지 않는다.
          if (s.phase === 'ended') return;
          if (isDraftSending(e) && s.id != null) {
            // 다른 탭·창에서 보내는 중이다 — 저장도 보내기도 멈춘다. id 는 그대로 둔다(보내기가 새 대기 행을 만들지 않게).
            // 이번에 저장하려던 내용은 저장되지 않았다 — 버리지 않고 남겨 두어(dirty) 상태 줄이 알리고, 닫을 때 새 임시저장으로 남긴다(코드 리뷰).
            s.dirty = true;
            setPhase(s, 'inflight');
            // 대기 행은 임시보관함에서 빠진다 — 목록·개수에 남은 그 줄을 걷어낸다.
            void invalidateMailDrafts(qc, snap.payload.accountId);
          } else if (isDraftGone(e) && s.id != null) {
            // 다른 곳에서 보냈거나 버렸다 — 되살리지 않는다(markGone).
            markGone(s, snap.payload.accountId);
          } else if (isConflict(e)) {
            // 이번 내용은 저장되지 않았다 — 닫을 때(flushSession) 새 임시저장으로 남길 변경으로 둔다.
            s.dirty = true;
            setPhase(s, 'conflict');
          } else if (isInvalid(e)) {
            // 같은 내용으로는 다시 시도하지 않는다 — 다음 입력(schedule)이 풀고 다시 저장한다.
            setPhase(s, 'invalid', shortSaveReason(extractApiError(e, '')));
          } else {
            // 실패한 내용은 다음 저장(다시 시도·다음 입력)에 다시 실린다.
            s.dirty = true;
            setPhase(s, 'error');
          }
        }
      });
      return s.chain.then(result);
    },
    [qc, show, setPhase, markGone],
  );

  /** 1.5초 뒤 저장하도록 타이머를 (다시) 건다. */
  const arm = useCallback(
    (s: Session) => {
      stopTimer(s);
      s.timer = setTimeout(() => void save(s), DRAFT_AUTOSAVE_DELAY_MS);
    },
    [save],
  );

  // 작성이 바뀌면 새 세션. 앞 작성의 남은 저장은 닫기·바꾸기 경로(flush)가 이미 돌렸다 — 여기서는 타이머만 멈춘다.
  useEffect(() => {
    if (instanceId == null) {
      session.current = null;
      return;
    }
    const s = newSession(instanceId, initialDraftId, initialVersion, !!initialUnsaved);
    session.current = s;
    // 「다시 열기」로 연 저장 안 된 내용 — 곧 다시 저장한다(그냥 닫아도 dirty 라 flush 가 저장한다).
    if (initialUnsaved) arm(s);
    return () => stopTimer(s);
    // 임시저장 id·버전은 열 때 한 번만 읽는다(첫 저장 뒤 컨텍스트에 묶이는 id 로 세션을 다시 만들지 않게).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  /**
   * 다른 곳에서 보내는 중(inflight)이면 서버를 다시 확인한다(WP-1786 코드 리뷰) — 다른 탭의 「되돌리기」나 대기열의 실패로 임시보관으로 돌아왔는데
   * 이 작성창이 영영 잠겨 있지 않게. inflight 가 되면 바로, 그 뒤 일정 간격과 창으로 돌아올 때(탭이 다시 보일 때) 상세를 받는다.
   * 간격 확인은 탭이 감춰져 있으면 쉰다(refetchIntervalInBackground 기본 false — 보이지 않는 탭이 계속 묻지 않게). 응답이 늦어도 같은 쿼리라
   * 요청이 겹치지 않는다. 재시도는 끈다 — 404 는 곧바로 gone 으로 보고, 네트워크 오류 등은 다음 간격에 다시 본다.
   * inflight 를 벗어나면(풀림·gone·닫음) enabled 가 꺼져 더 묻지 않는다.
   */
  const inflightDraftId = status === 'inflight' ? (current?.draftId ?? null) : null;
  const inflightCheck = useQuery({
    ...mailDraftQuery(inflightDraftId ?? 0),
    enabled: status === 'inflight' && inflightDraftId != null,
    refetchInterval: DRAFT_INFLIGHT_RECHECK_MS,
    refetchOnWindowFocus: true,
    retry: false,
  });
  // inflight 가 된 때 — 그 전에 캐시에 있던 상세(이 임시저장을 열 때 받은 값 등, 보내기 전이라 sendState 가 비었다)를 「풀렸다」로 잘못 읽지 않게
  // 이 시각 이후에 받은 결과에만 반응한다. 아래 반응 효과보다 먼저 선언해 같은 커밋에서 먼저 돈다.
  const inflightSince = useRef(0);
  useEffect(() => {
    if (status === 'inflight') inflightSince.current = Date.now();
  }, [status, instanceId]);
  /**
   * 다시 확인한 결과에 반응한다.
   * - 아직 보내는 중(QUEUED·SENDING)이면 그대로 둔다.
   * - 임시보관으로 돌아왔으면 충돌(conflict)로 넘어간다 — 서버 내용은 다른 곳에서 고쳐 보낸 것이라 이 창의 버전으로 덮지 않는다. 저장 못 한 변경이
   *   있으면 그대로 두어 이어 쓰고 「다시 불러오기」·닫을 때 새 임시저장으로 남기기를 고르게 하고, 없으면 호출부가 서버 내용으로 다시 연다(onSendReleased).
   * - 보내고 지워졌으면(404) gone — 다른 곳에서 보낸 메일이다(markGone — 여기서 보내면 새 메일로 나간다).
   * 네트워크 오류 등은 다음 확인에서 다시 본다. 그사이 닫았거나 버렸거나 다른 길로 풀렸으면 손대지 않는다.
   */
  const { data: checked, dataUpdatedAt, isError: checkFailed, error: checkError, errorUpdatedAt } = inflightCheck;
  useEffect(() => {
    const s = session.current;
    if (!s || s.phase !== 'inflight' || s.id == null || s.id !== inflightDraftId) return;
    const since = inflightSince.current;
    if (checkFailed) {
      if (errorUpdatedAt >= since && isDraftGone(checkError)) markGone(s, latest.current.accountId);
      return;
    }
    if (!checked || dataUpdatedAt < since || isSendInFlight(checked)) return;
    setPhase(s, 'conflict');
    if (!s.dirty) latest.current.onSendReleased?.(s.id);
  }, [inflightDraftId, checked, dataUpdatedAt, checkFailed, checkError, errorUpdatedAt, markGone, setPhase]);

  /**
   * 내용이 바뀌었다 — 1.5초 뒤 저장. 충돌 중에는 서버 내용을 덮지 않도록 미룬다(다시 불러오거나 닫을 때 처리).
   * 다른 곳에서 보내는 중(inflight)이면 저장하지 않고 저장 못 한 변경으로만 남긴다 — 상태 줄이 알리고, 닫을 때 새 임시저장으로 남긴다.
   */
  const schedule = useCallback(() => {
    const s = session.current;
    if (!s) return;
    if (s.phase === 'inflight') {
      s.dirty = true;
      show(s, 'inflight');
      return;
    }
    if (isStopped(s.phase)) return;
    s.dirty = true;
    // 내용이 바뀌었으니 검증 오류였던 내용과 다르다 — 다시 저장해 본다.
    if (s.phase === 'invalid') setPhase(s, 'active');
    // 보내는 중에는 미뤄 둔다(보내기가 실패하면 failed() 가 저장한다).
    if (s.phase === 'conflict' || s.sending) return;
    arm(s);
    show(s, 'pending');
  }, [arm, show, setPhase]);

  /**
   * 세션의 남은 저장을 바로 돌린다. 충돌 중이면 서버 내용을 덮지 않고 내 내용을 새 임시저장으로 남긴다 — 닫는 순간 쓴 것을 잃지 않게.
   * 서버 쪽 임시저장에 묶인 업로드도 그대로 싣는다 — 서버가 새 임시저장으로 옮겨 묶는다(서버 쪽 임시저장에서는 빠진다).
   */
  const flushSession = useCallback(
    (s: Session, force = false): Promise<DraftFlushResult> => {
      // 충돌 중이거나, 다른 곳에서 보내는 중(inflight)인데 이 창에서 저장하지 못한 변경이 있다 — 서버 쪽(고쳐진 것·대기 행)은 건드리지 않고
      // 내 내용을 새 임시저장으로 남긴다(WP-1786 코드 리뷰 — inflight 로 멈춘 뒤 쓴 것을 닫으며 잃지 않게). 저장 못 한 변경(dirty)만 남긴다 —
      // 보내기가 풀려 충돌로 넘어왔는데 이 창에 바뀐 것이 없으면(서버 내용으로 다시 열지 못한 채 닫음) 같은 메일을 하나 더 만들지 않는다.
      if (s.phase === 'conflict' || (s.phase === 'inflight' && s.dirty)) {
        setPhase(s, 'active');
        s.id = null;
        s.version = null;
      }
      // 강제 저장(새 창으로 열기) — 아직 서버에 없으면 바뀐 것이 없어도 만든다. 이미 있으면 남은 변경만 저장하면 된다.
      if (force && s.id == null) s.dirty = true;
      return save(s, force);
    },
    [save, setPhase],
  );

  /**
   * 지금 작성의 남은 저장을 바로 돌린다(✕·뒤로가기·다른 작성으로 바꾸기).
   * force 면 빈 작성도 임시저장으로 만든다 — 새 창으로 열기(WP-1535)는 그 id 로 새 창을 연다.
   */
  const flush = useCallback((opts?: { force?: boolean }): Promise<DraftFlushResult> => {
    const s = session.current;
    if (!s) return Promise.resolve({ wrote: false, ok: true, draftId: null, version: null });
    return flushSession(s, opts?.force ?? false);
  }, [flushSession]);

  /** 다시 시도(「저장하지 못했어요 · 다시 시도」) — 네트워크·서버 오류만. 검증 오류(invalid)는 내용을 고쳐야 풀린다. */
  const retry = useCallback(() => {
    const s = session.current;
    if (!s || s.phase === 'invalid') return;
    s.dirty = true;
    void save(s);
  }, [save]);

  /**
   * 보내기 시작 — 자동 저장·닫을 때 저장을 멈추고(보내면 서버가 임시저장을 지운다), 진행 중인 저장이 끝나 id 가 정해지길 기다린다.
   * 지금 내용을 이 세션 것으로 잡아 둔다. 돌려준 손잡이로 결과를 알린다.
   */
  const beginSend = useCallback(async (): Promise<DraftSendTicket> => {
    const s = session.current;
    const noop = () => {};
    if (!s) return { draftId: undefined, succeeded: noop, failed: () => null, alreadySending: noop };
    stopTimer(s);
    s.sending = true;
    s.snap = latest.current.getSnapshot();
    await s.chain;
    return {
      // 없어진 임시저장(gone)은 id 가 이미 비워졌다. 충돌 중이면 싣지 않는다 — 다른 곳에서 더 새로 저장한 임시저장을 지우지 않게.
      draftId: s.phase === 'conflict' ? undefined : (s.id ?? undefined),
      succeeded: () => endSession(s),
      failed: () => {
        s.sending = false;
        if (isStopped(s.phase)) return null;
        // 보내는 동안 작성창이 닫혔거나 다른 작성으로 바뀌었다 — 잡아 둔 이 세션의 내용을 바로 저장하고 결과를 돌려준다(검증 오류였어도 시도한다 —
        // 닫힌 작성은 고칠 수 없으니 실패하면 호출부가 저장 안 된 내용으로 다시 열게 한다).
        if (session.current !== s) {
          s.dirty = true;
          return flushSession(s);
        }
        // 검증 오류인 내용은 그대로는 저장되지 않는다 — 사유 표시를 두고, 고치면(schedule) 다시 저장한다.
        if (s.phase === 'invalid') return null;
        // 보내기 직전 미뤄 둔 변경과 보내는 동안 고친 내용을 저장한다.
        s.dirty = true;
        if (s.phase === 'conflict') return null;
        arm(s);
        show(s, 'pending');
        return null;
      },
      alreadySending: () => {
        stopTimer(s);
        s.sending = false;
        if (s.phase === 'ended') return;
        // 작성창이 그대로면 보내려던 내용 중 저장하지 못한 변경(dirty)을 남겨 둔다 — 상태 줄이 알리고 닫을 때 새 임시저장으로 남긴다(코드 리뷰).
        // 이미 닫혔거나 바뀐 작성이면 남길 화면이 없다 — 보내려던 내용은 다른 곳이 보내는 그 메일이라 새 임시저장을 만들지 않는다.
        if (session.current !== s) s.dirty = false;
        setPhase(s, 'inflight');
      },
    };
  }, [arm, show, setPhase, flushSession]);

  /** 이 세션을 끝낸다 — 이후 저장하지 않는다(없어진 임시저장을 닫을 때, 충돌 「다시 불러오기」 — 호출부가 서버 내용으로 다시 연다). */
  const end = useCallback(() => {
    if (session.current) endSession(session.current);
  }, []);

  /**
   * 버리기 — 기다리던 저장을 취소하고, 진행 중인 저장이 끝나 id 가 정해지면 지운다. 버린 내용을 「되돌리기」로 다시 만들 수 있게
   * 호출부가 스냅샷을 먼저 잡아 둔다. 서버에 없었으면(저장 전) 지울 것이 없다.
   */
  const discard = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    // 계정은 지금 읽어 둔다 — 호출부가 곧 작성창을 닫아 latest 의 계정이 비워진다(그러면 목록·개수를 다시 받지 못한다).
    const acc = latest.current.accountId;
    s.dirty = false;
    // 다른 곳에서 보내는 중(inflight)인 임시저장은 지우지 않는다 — 서버도 409 로 거절하고, 대기 행은 되돌리기로만 푼다. 이 작성만 닫는다.
    if (s.phase === 'inflight') {
      endSession(s);
      return;
    }
    // 아직 시작하지 않은 저장은 건너뛴다(만들자마자 지울 임시저장을 만들지 않게). 이미 나간 저장은 끝나길 기다려 그 id 를 지운다.
    endSession(s);
    await s.chain;
    if (s.id != null) {
      try {
        await deleteMailDraft(s.id);
      } catch (e) {
        // 이미 없으면(다른 곳에서 보냈거나 버림) 버린 것과 같다. 그 밖의 실패는 호출부가 「버리지 못했어요」로 알린다.
        // 지우지 못했으면 세션을 다시 살린다 — 작성창이 남는 경우(새 창, WP-1535) 이어 쓴 내용이 저장되고, 닫을 때 지금 내용을 저장한다.
        // 작성창이 이미 닫혔으면(앱 안 도크) 떨어진 세션이라 아무 저장도 걸리지 않는다.
        if (!isDraftGone(e)) {
          s.phase = 'active';
          s.dirty = true;
          throw e;
        }
      }
      if (acc != null) void invalidateMailDrafts(qc, acc);
    }
  }, [qc]);

  /**
   * 서버 임시저장 하나를 지우고 세션은 살려 둔다 — 새 창으로 옮기려 손대지 않은 작성으로 만든 빈 임시저장을 사용자가 빈 창을 닫아
   * 쓰지 않게 됐을 때, 임시보관함에 빈 채로 남지 않게 한다. discard 와 달리 작성창이 남으므로 세션을 끝내지 않고 id·버전만 끊어
   * 다음 입력이 새 임시저장으로 만들어지게 한다(그 id 가 지금 세션 것일 때만 — 다른 작성으로 바뀐 뒤면 서버 것만 지운다).
   * 지우지 못해도 빈 임시저장 하나가 남을 뿐이라 알리지 않는다(404 도 이미 없는 것).
   */
  const detach = useCallback(
    async (draftId: number) => {
      const s = session.current;
      const acc = latest.current.accountId;
      if (s && s.id === draftId) {
        s.id = null;
        s.version = null;
        s.wrote = false;
        // 이 id 로 저장된 상태 표시(저장됨)도 걷어낸다 — 아직 아무것도 저장되지 않은 새 작성으로 돌아간다.
        show(s, 'idle');
      }
      try {
        await deleteMailDraft(draftId);
      } catch {
        /* 빈 임시저장이 남을 뿐 — 알릴 결과가 없다 */
      }
      if (acc != null) void invalidateMailDrafts(qc, acc);
    },
    [qc, show],
  );

  /** 지금 세션의 임시저장 id(없으면 null). */
  const currentDraftId = () => session.current?.id ?? null;

  return { status, statusReason, inflightUnsaved, schedule, flush, retry, beginSend, end, discard, detach, currentDraftId };
}
