// 새 메일 AI 초안(WP-576) 상태 — 지시 패널 열림·생성·실패, 그리고 "AI 초안이에요" 줄과 되돌리기 스냅숏.
// 작성창(MailComposeDock)은 에디터·제목 반영만 하고, 언제 무엇을 보여 줄지는 이 훅이 정한다. 제목·되돌리기 규칙은 lib/mailAiDraft(순수 함수).

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { generateComposeDraft } from '@/api/mailMessages';
import { mailAccountKeys } from '@/hooks/queries/useMailAccounts';
import { extractApiError, extractApiErrorCode } from '@/lib/api-error';
import {
  composeDraftRequestSubject,
  nextUndoSnapshot,
  PERMANENT_COMPOSE_DRAFT_ERRORS,
  resolveDraftSubject,
  undoDraftSubject,
} from '@/lib/mailAiDraft';
import { plainTextToMailHtml } from '@/lib/mailQuote';

/** 지시 패널 단계 — 닫힘 / 지시 입력 / 생성 중 / 실패. 완료는 닫힘 + filled. */
export type AiDraftPhase = 'closed' | 'input' | 'generating' | 'error';

/** 생성 직전 작성창 모습 — 요청 문맥이자 [되돌리기] 대상. */
export interface AiDraftContext {
  to: string[];
  cc: string[];
  subject: string;
  /** 지금 에디터 본문 HTML(되돌리기용). */
  html: string;
}

/** 작성창에 반영할 결과 — 본문 HTML 과 제목(바꿀 게 없으면 지금 제목 그대로). */
export interface AiDraftApply {
  html: string;
  subject: string;
  /** 반영 뒤 본문에 초점을 줄지 — 응답이 도착한 때 사용자가 다른 칸에 쓰고 있었으면 false(되돌리기 결과엔 없다). */
  focusBody?: boolean;
}

/** 응답이 도착한 순간(작성창 상태를 바꾸기 전) 읽는 작성창 모습. */
export interface AiDraftLive {
  /** 지금 제목 — 생성 중 사용자가 쓴 제목을 AI 제목이 덮지 않게. */
  subject: string;
  /** 다른 칸(제목·검색 등)에 쓰고 있는가 — 그렇다면 초점을 빼앗지 않는다. */
  typingElsewhere: boolean;
}

/** 실패 — 표시 문구와, 다시 시도해도 같은 결과인 영구 사유(계정 AI 꺼짐·비서 미설정)인지. */
export interface AiDraftError {
  message: string;
  permanent: boolean;
}

const FALLBACK_ERROR = '초안을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.';

export function useMailAiDraft(accountId: number | undefined) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<AiDraftPhase>('closed');
  const [instruction, setInstruction] = useState('');
  // 마지막 실패 — phase 가 'error' 일 때만 밖으로 보인다(다른 단계로 가면 따로 비우지 않아도 된다).
  const [lastError, setLastError] = useState<AiDraftError | null>(null);
  // 본문이 AI 초안 그대로인가 — "AI 초안이에요 · 다시 쓰기 · 되돌리기" 줄을 보일지.
  const [filled, setFilled] = useState(false);

  // [되돌리기] 대상 — 처음 AI 초안을 넣기 직전 모습. 손대지 않은 초안을 [다시 쓰기]해도 그대로 둬 맨 처음으로 돌아간다.
  const snapshotRef = useRef<AiDraftContext | null>(null);
  // AI 가 넣은 본문 HTML(에디터가 정규화한 값) — 이와 다른 본문 변경이 오면 사용자가 고친 것이다.
  const aiHtmlRef = useRef<string | null>(null);
  // AI 가 채운 제목 — 사용자가 손대지 않았으면 [다시 쓰기] 때 새 제목으로 바꾸고, [되돌리기] 때 생성 직전 제목으로 돌린다.
  const aiSubjectRef = useRef<string | null>(null);
  // 다음 본문 변경이 AI 반영(setContent)에서 온 것인지 — 그 HTML 을 aiHtmlRef 로 받아 둔다.
  const applyingRef = useRef(false);
  // 진행 중 요청의 취소기 — 새 작성창으로 바뀌거나 중지·닫기·다시 생성하면 끊고, 그 요청의 늦은 응답·실패는 signal.aborted 로 버린다.
  const abortRef = useRef<AbortController | null>(null);

  /** 진행 중 요청을 끊는다 — 그 요청의 응답·실패는 이후 무시된다. */
  const cancelRun = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /** 새 작성창(instanceId 변경)·작성창 닫기마다 처음 상태로 — 진행 중 요청은 끊는다. */
  const reset = useCallback(() => {
    cancelRun();
    setPhase('closed');
    setInstruction('');
    setFilled(false);
    snapshotRef.current = null;
    aiHtmlRef.current = null;
    aiSubjectRef.current = null;
    applyingRef.current = false;
  }, [cancelRun]);

  /** 지시 패널 열기 — [다시 쓰기]도 같은 함수(지시는 지난 값 그대로 남아 있다). */
  const open = useCallback(() => {
    setPhase('input');
  }, []);

  /** 패널 닫기(취소·Esc·닫기). 생성 중이면 먼저 중지한다. */
  const close = useCallback(() => {
    cancelRun();
    setPhase('closed');
  }, [cancelRun]);

  /** [중지] — 요청을 끊고 지시를 남긴 채 입력 단계로 돌아간다(오류로 보지 않는다). */
  const stop = useCallback(() => {
    cancelRun();
    setPhase('input');
  }, [cancelRun]);

  /**
   * 초안 생성. 성공하면 작성창에 반영할 값을, 중지·실패·작성창 교체면 null 을 돌려준다.
   * readLive 는 응답이 도착한 순간(패널 상태를 바꾸기 전)의 제목·초점을 읽는다 — 생성 중 사용자가 쓴 제목을 AI 제목이 덮지 않고(판정은 lib/mailAiDraft),
   * 다른 칸에 쓰던 초점을 빼앗지 않게. 패널을 닫은 뒤에 읽으면 초점이 이미 body 로 떨어져 판정이 틀린다.
   * 돌려받은 값을 바로(같은 틱에) 에디터에 setContent 해야 noteBodyChange 가 그 HTML 을 AI 본문으로 받아 둔다.
   */
  const generate = useCallback(
    async (ctx: AiDraftContext, readLive: () => AiDraftLive): Promise<AiDraftApply | null> => {
      const text = instruction.trim();
      if (accountId == null || !text) return null;
      cancelRun();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase('generating');
      try {
        const result = await generateComposeDraft(
          accountId,
          {
            instruction: text,
            to: ctx.to,
            cc: ctx.cc,
            subject: composeDraftRequestSubject(ctx.subject, aiSubjectRef.current),
          },
          controller.signal,
        );
        // 그사이 중지·닫기·작성창 교체·다시 생성으로 끊겼으면 늦게 온 응답은 버린다(각 경로가 단계를 이미 정했다).
        if (controller.signal.aborted) return null;
        const live = readLive();
        // 손대지 않은 AI 초안을 다시 쓰는 중이면 되돌리기 대상은 맨 처음 모습 그대로.
        snapshotRef.current = nextUndoSnapshot(snapshotRef.current, filled, ctx);
        const next = resolveDraftSubject({
          now: live.subject,
          atRequest: ctx.subject,
          aiSubject: aiSubjectRef.current,
          resultSubject: result.subject,
        });
        aiSubjectRef.current = next.aiSubject;
        applyingRef.current = true;
        abortRef.current = null;
        setPhase('closed');
        setFilled(true);
        return { html: plainTextToMailHtml(result.body), subject: next.subject, focusBody: !live.typingElsewhere };
      } catch (e) {
        if (controller.signal.aborted) return null;
        abortRef.current = null;
        const code = extractApiErrorCode(e);
        const permanent = code != null && PERMANENT_COMPOSE_DRAFT_ERRORS.has(code);
        // 계정 AI 가 꺼졌다면 계정 목록을 새로 받아 작성창의 AI 진입점이 사라지게 한다.
        if (permanent) void qc.invalidateQueries({ queryKey: mailAccountKeys.all });
        setLastError({ message: extractApiError(e, FALLBACK_ERROR), permanent });
        setPhase('error');
        return null;
      }
    },
    [accountId, instruction, filled, cancelRun, qc],
  );

  /** 에디터 본문 변경마다 호출 — AI 반영이면 그 HTML 을 기억하고, 그 뒤 다른 HTML 이 오면 사용자가 고친 것이라 줄을 걷는다. */
  const noteBodyChange = useCallback((html: string) => {
    if (applyingRef.current) {
      applyingRef.current = false;
      aiHtmlRef.current = html;
      return;
    }
    if (aiHtmlRef.current != null && html !== aiHtmlRef.current) {
      aiHtmlRef.current = null;
      snapshotRef.current = null;
      setFilled(false);
    }
  }, []);

  /**
   * [되돌리기] — 생성 직전 본문과 제목을 돌려준다(줄은 걷힌다).
   * 제목은 지금 제목이 AI 가 넣은 그대로일 때만 되돌리고, 사용자가 고쳤으면 지금 제목을 지킨다.
   */
  const undo = useCallback((subjectNow: string): AiDraftApply | null => {
    const snap = snapshotRef.current;
    const subject = snap ? undoDraftSubject(subjectNow, aiSubjectRef.current, snap.subject) : subjectNow;
    snapshotRef.current = null;
    aiHtmlRef.current = null;
    aiSubjectRef.current = null;
    setFilled(false);
    return snap ? { html: snap.html, subject } : null;
  }, []);

  const error = phase === 'error' ? lastError : null;
  return { phase, instruction, setInstruction, error, filled, reset, open, close, stop, generate, noteBodyChange, undo };
}
