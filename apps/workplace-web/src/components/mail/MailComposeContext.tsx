// 메일 작성 도크 컨텍스트 — 앱 어디서든 새/답장/전달을 prefill 상태로 도크 오픈.
// v1 단일 창(동시 1통). 도크 본체는 MailComposeDock 이 렌더.
// 임시저장(WP-577): 다른 작성으로 바뀌기 전에 작성창이 등록한 저장(handlers.save)을 먼저 돌리고,
// 같은 임시저장을 다시 열면 새로 열지 않고 지금 창을 앞으로 가져온다(handlers.raise). 임시보관함에서 지운 임시저장이
// 열려 있으면 저장 없이 닫는다(closeDraft — 지운 임시저장을 다시 저장하지 않게).

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { ComposeAttachment } from '@/lib/mailComposeAttachments';
import type { MailQuote } from '@/lib/mailQuote';
import type { ComposeMode } from '@/types/mailDraft';

// 작성 종류는 임시저장 DTO 와 같은 값이라 types 에 두고 여기서 다시 내보낸다(기존 import 경로 호환).
export type { ComposeMode };

/** 작성 초기값(새/답장/전달·임시저장이 채워 보낸다). */
export interface ComposeDraft {
  /** 작성 종류. 화면 제목과 새 메일 전용 기능(AI 초안)이 이 값으로 갈린다. */
  mode: ComposeMode;
  accountId: number;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** 초기 본문 HTML — 내가 쓸 부분만. 답장/전달은 ''(AI 초안이면 그 초안). */
  initialHtml: string;
  /**
   * 인용문 — html/text/meta/variant 를 하나로 묶은 객체. 에디터 미경유·불변.
   * 없으면 null(이 값이 "인용문 없음"의 단일 판별자다). 4개 평면 필드였던 이전 표현은
   * "quoteHtml 만 있고 meta 없음" 같은 불가능한 상태를 타입으로 배제하지 못했다.
   */
  quote: MailQuote | null;
  /**
   * 처음 붙어 있는 첨부(WP-574) — 전달은 원본 메일의 첨부가 미리 들어간다(각각 ✕ 로 뺄 수 있다).
   * 없으면 빈 목록. 작성 중 바뀌는 첨부 상태는 작성창(useMailComposeAttachments)이 들고, 이 값은 시작값으로만 쓴다.
   */
  attachments?: ComposeAttachment[];
  /** 답장 대상 로컬 message id(없으면 새 메일/전달). */
  inReplyToMessageId: number | null;
  /**
   * 답장·전달의 원본 메일 id(WP-577) — 임시저장을 다시 열 때 인용문을 원본으로 다시 만든다.
   * 전달은 inReplyToMessageId 가 null 이라 이 값이 없으면 원본을 찾을 수 없다. 새 메일은 없음.
   */
  sourceMessageId?: number | null;
  /** 작성 중 인용문을 지웠는가(WP-577) — 임시보관함에서 다시 열 때 이어받아 다음 저장에도 그대로 싣는다. 생략하면 false. */
  quoteRemoved?: boolean;
  /** 저장에 실패해 「다시 열기」로 연 작성 — 처음부터 저장 안 된 상태라 곧 다시 저장하고, 그냥 닫아도 저장한다. */
  unsaved?: boolean;
  /** 이 작성의 임시저장 id — 임시보관함에서 열었거나 첫 자동 저장(POST)이 끝나면 생긴다. */
  draftId?: number;
  /** 임시보관함에서 열 때의 서버 버전 — 첫 PUT 에 싣는다. */
  draftVersion?: number;
  /** openCompose 마다 부여되는 고유 인스턴스 id(에디터 재마운트 key 용). */
  instanceId?: number;
}

interface MailComposeContextValue {
  draft: ComposeDraft | null;
  /** 작성창 열기. 다른 작성이 열려 있으면 그 작성의 저장을 먼저 돌린다(skipSave 면 건너뛴다 — 충돌 다시 불러오기). */
  openCompose: (draft: ComposeDraft, opts?: { skipSave?: boolean }) => void;
  closeCompose: () => void;
  /** 그 작성이 아직 열려 있을 때만 닫는다 — 보내는 동안 다른 작성으로 바뀌었으면 그 작성을 닫지 않게. */
  closeInstance: (instanceId: number) => void;
  /** 인용문 제거 — 기밀 문단을 빼고 회신하는 시나리오. instanceId 는 유지(에디터 리마운트 금지). */
  clearQuote: () => void;
  /** 첫 자동 저장으로 받은 id 를 지금 작성에 묶는다(instanceId 유지) — 같은 임시저장을 다시 열 때 알아보게. */
  bindDraftId: (instanceId: number, draftId: number) => void;
  /** 그 임시저장이 지금 열려 있으면 앞으로 가져오고(handlers.raise) true. */
  focusDraft: (draftId: number) => boolean;
  /** 그 임시저장이 지금 열려 있으면 저장하지 않고 닫고 true — 임시보관함에서 지울 때. */
  closeDraft: (draftId: number) => boolean;
  /** 작성창이 등록하는 손잡이(닫히면 null) — 다른 작성으로 바뀌기 직전 save, 같은 임시저장을 다시 열 때 raise, 지운 임시저장을 닫을 때 abandon. */
  setComposeHandlers: (h: ComposeHandlers | null) => void;
}

/** 작성창(도크)이 컨텍스트에 맡기는 임시저장 동작. */
export interface ComposeHandlers {
  /** 남은 변경을 바로 저장(결과는 작성창이 토스트로 알린다). */
  save: () => void;
  /** 창을 앞으로 가져온다 — 최소화했으면 작은 창으로 펼친다. */
  raise: () => void;
  /** 이후 저장하지 않는다(기다리던 저장도 버린다). */
  abandon: () => void;
}

const MailComposeContext = createContext<MailComposeContextValue | null>(null);

/** 도크 상태 provider. AppLayout 이 감싼다. */
export function MailComposeProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  // 같은 ms 충돌을 피하려 단조 증가 ref 카운터로 인스턴스 id 를 찍는다.
  const seq = useRef(0);
  // 지금 작성 — focusDraft·bindDraftId 가 렌더 클로저가 아니라 최신 값을 보게 ref 로도 둔다.
  const draftRef = useRef<ComposeDraft | null>(null);
  const handlers = useRef<ComposeHandlers | null>(null);

  const commit = useCallback((d: ComposeDraft | null) => {
    draftRef.current = d;
    setDraft(d);
  }, []);

  const openCompose = useCallback(
    (d: ComposeDraft, opts?: { skipSave?: boolean }) => {
      // 열려 있는 작성이 있으면 그 내용을 먼저 저장한다 — 다른 메일에 답장을 눌러도 쓰던 것이 임시보관함에 남게.
      if (draftRef.current && !opts?.skipSave) handlers.current?.save();
      commit({ ...d, instanceId: ++seq.current });
    },
    [commit],
  );
  const closeCompose = useCallback(() => commit(null), [commit]);
  const closeInstance = useCallback(
    (instanceId: number) => {
      if (draftRef.current?.instanceId === instanceId) commit(null);
    },
    [commit],
  );
  const clearQuote = useCallback(() => {
    const d = draftRef.current;
    if (d) commit({ ...d, quote: null });
  }, [commit]);
  const bindDraftId = useCallback(
    (instanceId: number, draftId: number) => {
      const d = draftRef.current;
      if (d && d.instanceId === instanceId && d.draftId !== draftId) commit({ ...d, draftId });
    },
    [commit],
  );
  const focusDraft = useCallback((draftId: number) => {
    if (draftRef.current?.draftId !== draftId) return false;
    handlers.current?.raise();
    return true;
  }, []);
  const closeDraft = useCallback(
    (draftId: number) => {
      if (draftRef.current?.draftId !== draftId) return false;
      // 지운 임시저장에 늦게 PUT 하지 않게 저장을 먼저 멈추고 닫는다(쓰던 변경은 지우기와 함께 버려진다).
      handlers.current?.abandon();
      commit(null);
      return true;
    },
    [commit],
  );
  const setComposeHandlers = useCallback((h: ComposeHandlers | null) => {
    handlers.current = h;
  }, []);

  const value = useMemo(
    () => ({ draft, openCompose, closeCompose, closeInstance, clearQuote, bindDraftId, focusDraft, closeDraft, setComposeHandlers }),
    [draft, openCompose, closeCompose, closeInstance, clearQuote, bindDraftId, focusDraft, closeDraft, setComposeHandlers],
  );

  return (
    <MailComposeContext.Provider value={value}>{children}</MailComposeContext.Provider>
  );
}

/** 도크 컨트롤 훅. */
// eslint-disable-next-line react-refresh/only-export-components
export function useMailCompose() {
  const ctx = useContext(MailComposeContext);
  if (!ctx) throw new Error('useMailCompose must be used within MailComposeProvider');
  return ctx;
}
