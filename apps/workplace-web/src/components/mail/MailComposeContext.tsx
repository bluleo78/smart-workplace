// 메일 작성 도크 컨텍스트 — 앱 어디서든 새/답장/전달을 prefill 상태로 도크 오픈.
// v1 단일 창(동시 1통). 도크 본체는 MailComposeDock 이 렌더.

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { ComposeAttachment } from '@/lib/mailComposeAttachments';
import type { MailQuote } from '@/lib/mailQuote';

/**
 * 작성 종류 — 새 메일 / 회신 / 전달.
 * 인용문·답장 대상만으로 추론하면 전달에서 인용문을 지운 순간 새 메일과 구분되지 않으므로(WP-576 — 새 메일 전용 AI 초안) 명시한다.
 */
export type ComposeMode = 'new' | 'reply' | 'forward';

/** 작성 초기값(새/답장/전달이 채워 보낸다). */
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
  /** openCompose 마다 부여되는 고유 인스턴스 id(에디터 재마운트 key 용). */
  instanceId?: number;
}

interface MailComposeContextValue {
  draft: ComposeDraft | null;
  openCompose: (draft: ComposeDraft) => void;
  closeCompose: () => void;
  /** 인용문 제거 — 기밀 문단을 빼고 회신하는 시나리오. instanceId 는 유지(에디터 리마운트 금지). */
  clearQuote: () => void;
}

const MailComposeContext = createContext<MailComposeContextValue | null>(null);

/** 도크 상태 provider. MailModuleLayout 이 감싼다. */
export function MailComposeProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  // 같은 ms 충돌을 피하려 단조 증가 ref 카운터로 인스턴스 id 를 찍는다.
  const seq = useRef(0);

  const openCompose = useCallback(
    (d: ComposeDraft) => setDraft({ ...d, instanceId: ++seq.current }),
    [],
  );
  const closeCompose = useCallback(() => setDraft(null), []);
  const clearQuote = useCallback(
    () => setDraft((d) => (d ? { ...d, quote: null } : d)),
    [],
  );

  const value = useMemo(
    () => ({ draft, openCompose, closeCompose, clearQuote }),
    [draft, openCompose, closeCompose, clearQuote],
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
