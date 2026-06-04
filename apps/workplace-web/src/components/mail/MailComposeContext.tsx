// 메일 작성 도크 컨텍스트 — 앱 어디서든 새/답장/전달을 prefill 상태로 도크 오픈.
// v1 단일 창(동시 1통). 도크 본체는 MailComposeDock 이 렌더.

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** 작성 초기값(새/답장/전달이 채워 보낸다). */
export interface ComposeDraft {
  accountId: number;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** 초기 본문 HTML(인용문 등). */
  initialHtml: string;
  /** 답장 대상 로컬 message id(없으면 새 메일/전달). */
  inReplyToMessageId: number | null;
  /** openCompose 마다 부여되는 고유 인스턴스 id(에디터 재마운트 key 용). */
  instanceId?: number;
}

interface MailComposeContextValue {
  draft: ComposeDraft | null;
  openCompose: (draft: ComposeDraft) => void;
  closeCompose: () => void;
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

  const value = useMemo(
    () => ({ draft, openCompose, closeCompose }),
    [draft, openCompose, closeCompose],
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
