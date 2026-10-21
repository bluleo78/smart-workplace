// 메일 작성창 자동 임시저장(WP-577) — 내용이 바뀌면 1.5초 뒤 저장(첫 저장 POST, 이후 PUT+version).
// 저장은 작성(instanceId) 하나에 묶인 세션 객체에 이어 붙인다(chain) — 첫 POST 가 끝나기 전에 바뀌어도 id 를 받은 뒤 PUT 해
// 임시저장이 둘로 생기지 않고, 다른 작성으로 바뀐 뒤 늦게 끝난 저장이 새 작성의 id·버전을 덮지 않는다.
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createMailDraft, deleteMailDraft, updateMailDraft } from '@/api/mailDrafts';
import { invalidateMailDrafts } from '@/hooks/queries/mailDraftKeys';
import { patchMailDraftRow } from '@/hooks/queries/useMailDrafts';
import { extractApiError, extractApiErrorCode, isNotFoundError } from '@/lib/api-error';
import { DRAFT_CONFLICT, DRAFT_NOT_FOUND, type MailDraftSaveRequest } from '@/types/mailDraft';

/** 내용이 바뀐 뒤 저장까지 기다리는 시간. */
export const DRAFT_AUTOSAVE_DELAY_MS = 1500;

/**
 * 저장 상태 — idle(저장할 것 없음) / pending(바뀜, 디바운스 대기) / saving / saved /
 * error(네트워크·5xx·계정 404 등 — 다시 시도) / invalid(400 검증 — 원인을 보이고 같은 내용으로는 다시 시도하지 않는다) /
 * conflict(409 — 다른 곳에서 먼저 고침) /
 * gone(404 DRAFT_NOT_FOUND — 다른 곳에서 보냈거나 버림. 되살리지 않고 자동 저장을 멈춘다. 작성창은 남아 여기서 보낼 수 있다).
 */
export type DraftSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'invalid' | 'conflict' | 'gone';

/** 저장하지 않은 변경이 남은 상태 — 새로고침·탭 닫기 경고 대상. */
export function hasUnsavedDraft(status: DraftSaveStatus): boolean {
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
 * gone(404 — 다른 곳에서 보냈거나 버림, 이후 저장 안 함) / ended(보냈거나 버림·다시 불러오기 — 이후 저장 안 함).
 * 한 값이라 앞 실패가 뒤 상태에 남지 않는다(예: 검증 오류 뒤 네트워크 오류면 「다시 시도」가 산다).
 */
type SessionPhase = 'active' | 'error' | 'invalid' | 'conflict' | 'gone' | 'ended';

/** 단계가 화면에 그대로 보이는 상태 — active·ended 는 저장 흐름(pending·saving·saved·idle)이 정한다. */
const PHASE_STATUS: Partial<Record<SessionPhase, DraftSaveStatus>> = {
  error: 'error',
  invalid: 'invalid',
  conflict: 'conflict',
  gone: 'gone',
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
}

/**
 * 작성창 자동 임시저장 훅. 작성창은 내용이 바뀔 때 schedule, 닫을 때 flush, 보낼 때 beginSend(→ 손잡이 succeeded·failed), 버릴 때 discard 를 부른다.
 * 저장 실패는 다음 입력·다시 시도에 다시 실리고, 409 충돌이면 서버 내용을 덮지 않고 멈춘다(다시 불러오기·닫을 때 새 임시저장으로 남기기).
 * 404 면 다른 곳에서 보냈거나 버린 것이라 되살리지 않고 멈춘다(gone).
 */
export function useMailDraftAutosave({ instanceId, initialDraftId, initialVersion, initialUnsaved, accountId, getSnapshot, onCreated }: Options) {
  const qc = useQueryClient();
  // 상태는 작성(instanceId)에 묶어 둔다 — 새 작성으로 바뀌면 effect 없이 렌더 중에 처음 상태(임시보관함에서 열면 저장됨, 다시 열기면 저장 중…)로 보인다.
  const [shown, setShown] = useState<{ instanceId: number; status: DraftSaveStatus; reason?: string } | null>(null);
  const current = instanceId != null && shown?.instanceId === instanceId ? shown : null;
  const status: DraftSaveStatus =
    instanceId == null ? 'idle' : current ? current.status : initialUnsaved ? 'pending' : initialDraftId != null ? 'saved' : 'idle';
  /** invalid 의 원인(짧은 문구). */
  const statusReason = current?.reason;
  const session = useRef<Session | null>(null);
  // 최신 콜백 — 타이머·사슬이 렌더 클로저가 아니라 지금 값을 읽게.
  const latest = useRef({ getSnapshot, onCreated, accountId });
  useLayoutEffect(() => {
    latest.current = { getSnapshot, onCreated, accountId };
  });

  /**
   * 지금 세션의 상태만 화면에 반영한다(바뀐 뒤 늦게 끝난 앞 작성의 저장이 새 작성 표시를 바꾸지 않게).
   * 같은 상태면 이전 값을 그대로 둬 입력마다 다시 그리지 않는다.
   */
  const show = useCallback((s: Session, next: DraftSaveStatus, reason?: string) => {
    if (session.current !== s) return;
    setShown((prev) =>
      prev?.instanceId === s.instanceId && prev.status === next && prev.reason === reason
        ? prev
        : { instanceId: s.instanceId, status: next, reason },
    );
  }, []);

  /** 단계를 바꾸고, 화면에 보이는 단계면 함께 보인다 — 단계는 늘 여기서만 바꿔 표시와 어긋나지 않게. */
  const setPhase = useCallback(
    (s: Session, phase: SessionPhase, reason?: string) => {
      s.phase = phase;
      const status = PHASE_STATUS[phase];
      if (status) show(s, status, reason);
    },
    [show],
  );

  /** 세션의 변경을 지금 저장 사슬에 잇는다. 결과 promise 는 이 저장까지 끝나면 풀린다. */
  const save = useCallback(
    (s: Session): Promise<DraftFlushResult> => {
      stopTimer(s);
      // 화면의 내용은 지금 세션일 때만 이 세션 것이다 — 보내는 중에 닫거나 바꾸는 순간의 내용도 여기서 잡아 둔다.
      const own = session.current === s;
      if (own && s.sending) s.snap = latest.current.getSnapshot();
      // 없어진 임시저장은 저장한 것이 없는 것으로 알린다 — 닫을 때 「임시보관함에 저장했어요」를 띄우지 않는다.
      // 보내는 중에 닫으면 저장하지 않고 알리지도 않는다(보내기가 결과를 알린다).
      const result = (): DraftFlushResult =>
        s.phase === 'gone' || s.sending
          ? { wrote: false, ok: true, draftId: null, version: null }
          : {
              wrote: s.wrote,
              ok: s.phase !== 'error' && s.phase !== 'conflict' && s.phase !== 'invalid',
              draftId: s.id,
              version: s.version,
            };
      const stopped = () => s.phase === 'ended' || s.phase === 'gone' || s.sending;
      if (!s.dirty || stopped() || s.phase === 'conflict') return s.chain.then(result);
      // 내용은 지금 읽는다 — 사슬이 기다리는 동안 작성이 바뀌어도 이 시점의 내용이 저장된다. 떨어진 세션은 잡아 둔 자기 내용만 쓴다.
      const snap = own ? latest.current.getSnapshot() : s.snap;
      if (!snap) return s.chain.then(result);
      s.snap = snap;
      s.dirty = false;
      if (snap.empty && s.id == null) {
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
          if (isDraftGone(e) && s.id != null) {
            // 다른 곳에서 보냈거나 버렸다 — 되살리지 않는다. id 를 비워 보내기가 없는 draftId 를 싣지 않게 한다.
            s.id = null;
            s.version = null;
            s.dirty = false;
            setPhase(s, 'gone');
            // 임시보관함 목록·개수에 남은 그 줄을 걷어낸다 — 남겨 두면 눌러도 열리지 않는 줄이 된다.
            void invalidateMailDrafts(qc, snap.payload.accountId);
          } else if (isConflict(e)) {
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
    [qc, show, setPhase],
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

  /** 내용이 바뀌었다 — 1.5초 뒤 저장. 충돌 중에는 서버 내용을 덮지 않도록 미룬다(다시 불러오거나 닫을 때 처리). */
  const schedule = useCallback(() => {
    const s = session.current;
    if (!s || s.phase === 'ended' || s.phase === 'gone') return;
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
    (s: Session): Promise<DraftFlushResult> => {
      if (s.phase === 'conflict') {
        setPhase(s, 'active');
        s.id = null;
        s.version = null;
        s.dirty = true;
      }
      return save(s);
    },
    [save, setPhase],
  );

  /** 지금 작성의 남은 저장을 바로 돌린다(✕·뒤로가기·다른 작성으로 바꾸기). */
  const flush = useCallback((): Promise<DraftFlushResult> => {
    const s = session.current;
    if (!s) return Promise.resolve({ wrote: false, ok: true, draftId: null, version: null });
    return flushSession(s);
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
    if (!s) return { draftId: undefined, succeeded: noop, failed: () => null };
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
        if (s.phase === 'ended' || s.phase === 'gone') return null;
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
    };
  }, [arm, show, flushSession]);

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
    // 아직 시작하지 않은 저장은 건너뛴다(만들자마자 지울 임시저장을 만들지 않게). 이미 나간 저장은 끝나길 기다려 그 id 를 지운다.
    endSession(s);
    await s.chain;
    if (s.id != null) {
      try {
        await deleteMailDraft(s.id);
      } catch (e) {
        // 이미 없으면(다른 곳에서 보냈거나 버림) 버린 것과 같다. 그 밖의 실패는 호출부가 「버리지 못했어요」로 알린다.
        if (!isDraftGone(e)) throw e;
      }
      if (acc != null) void invalidateMailDrafts(qc, acc);
    }
  }, [qc]);

  /** 지금 세션의 임시저장 id(없으면 null). */
  const currentDraftId = () => session.current?.id ?? null;

  return { status, statusReason, schedule, flush, retry, beginSend, end, discard, currentDraftId };
}
