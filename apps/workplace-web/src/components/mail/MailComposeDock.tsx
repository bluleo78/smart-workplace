// Gmail식 우하단 도킹 작성창. 최소화/복원/닫기. 보내기 = useSendMail.
// MailComposeProvider 의 draft 가 있으면 렌더, 없으면 null.

import axios from 'axios';
import { Minus, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { useCoachDraft, useSendMail } from '../../hooks/queries/useMailMessages';
import type { CoachingNote } from '../../types/mailMessage';
import { useMailCompose } from './MailComposeContext';
import { MailComposer, type MailComposerHandle } from './MailComposer';

/** 주소 문자열("a@x, b@y")을 배열로 파싱. */
function parseAddresses(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 작성 도크 본체. draft 없으면 렌더 안 함. */
export function MailComposeDock() {
  const { draft, closeCompose } = useMailCompose();
  const send = useSendMail(draft?.accountId);

  const composerRef = useRef<MailComposerHandle>(null);
  const coach = useCoachDraft();
  const [tab, setTab] = useState<'compose' | 'review'>('compose');
  const [hasBody, setHasBody] = useState(false);
  // 마지막으로 코칭한 본문 평문 — 본문이 바뀌면(편집/개선본 교체) 재검토를 트리거하기 위한 stale 가드.
  const lastCoachedRef = useRef<string | null>(null);

  const [minimized, setMinimized] = useState(false);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  // 본문은 ref 로 보관(매 키 입력마다 리렌더 방지).
  const bodyHtmlRef = useRef('');
  const bodyTextRef = useRef('');

  // 새 draft 가 열릴 때마다 폼 초기화.
  useEffect(() => {
    if (!draft) return;
    setMinimized(false);
    setTo(draft.to.join(', '));
    setCc(draft.cc.join(', '));
    setBcc(draft.bcc.join(', '));
    setShowCcBcc(draft.cc.length > 0 || draft.bcc.length > 0);
    setSubject(draft.subject);
    bodyHtmlRef.current = draft.initialHtml;
    bodyTextRef.current = '';
    // 새 draft 진입 시 탭/코칭 결과 초기화.
    setTab('compose');
    coach.reset();
    lastCoachedRef.current = null;
    setHasBody(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) return null;

  // "AI 검토" 진입 시 호출. 본문이 직전 코칭과 같으면 캐시 재사용, 다르면 새로 코칭.
  const runCoaching = () => {
    if (coach.isPending) return;
    if (coach.data && lastCoachedRef.current === bodyTextRef.current) return;
    lastCoachedRef.current = bodyTextRef.current;
    coach.reset();
    coach.mutate({
      accountId: draft.accountId,
      bodyHtml: bodyHtmlRef.current,
      bodyText: bodyTextRef.current,
      inReplyToMessageId: draft.inReplyToMessageId,
    });
  };

  const onSend = () => {
    send.mutate(
      {
        to: parseAddresses(to),
        cc: parseAddresses(cc),
        bcc: parseAddresses(bcc),
        subject,
        bodyHtml: bodyHtmlRef.current,
        bodyText: bodyTextRef.current,
        inReplyToMessageId: draft.inReplyToMessageId,
      },
      { onSuccess: () => closeCompose() },
    );
  };

  return (
    <div
      data-testid="mail-compose-dock"
      className="fixed bottom-0 right-4 z-50 flex w-[32rem] max-w-[calc(100vw-2rem)] flex-col rounded-t-lg border border-b-0 bg-background shadow-2xl"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between rounded-t-lg bg-muted px-3 py-2">
        <span className="truncate text-sm font-medium">{subject || '새 메일'}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="최소화"
            data-testid="mail-compose-minimize"
            onClick={() => setMinimized((v) => !v)}
            className="rounded p-1 hover:bg-accent"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="닫기"
            data-testid="mail-compose-close"
            onClick={closeCompose}
            className="rounded p-1 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="flex flex-col gap-2 p-3">
          {/* 수신자 */}
          <div className="flex items-center gap-2 border-b pb-2">
            <input
              data-testid="mail-compose-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="받는사람"
              className="min-w-0 flex-1 rounded-sm bg-transparent text-sm outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
            />
            {!showCcBcc && (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                참조/숨은참조
              </button>
            )}
          </div>
          {showCcBcc && (
            <>
              <input
                data-testid="mail-compose-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="참조"
                className="border-b bg-transparent pb-2 text-sm outline-none focus-visible:border-primary focus-visible:outline-none"
              />
              <input
                data-testid="mail-compose-bcc"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
                placeholder="숨은참조"
                className="border-b bg-transparent pb-2 text-sm outline-none focus-visible:border-primary focus-visible:outline-none"
              />
            </>
          )}
          {/* 제목 */}
          <input
            data-testid="mail-compose-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="제목"
            className="border-b bg-transparent pb-2 text-sm outline-none focus-visible:border-primary focus-visible:outline-none"
          />
          {/* 작성/AI 검토 탭 */}
          <div className="flex border-b border-border text-sm" data-testid="mail-compose-tabs">
            <button
              type="button"
              className={`flex-1 py-1.5 font-medium ${tab === 'compose' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
              onClick={() => setTab('compose')}
            >
              작성
            </button>
            <button
              type="button"
              data-testid="mail-review-tab"
              disabled={!hasBody}
              className={`flex-1 py-1.5 font-medium disabled:opacity-50 ${tab === 'review' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'}`}
              onClick={() => {
                setTab('review');
                runCoaching();
              }}
            >
              ✦ AI 검토
            </button>
          </div>

          {/* 본문(작성 탭) — review 일 때 숨김(언마운트 금지) */}
          <div className={tab === 'review' ? 'hidden' : ''}>
            <MailComposer
              key={draft.instanceId}
              ref={composerRef}
              initialHtml={draft.initialHtml}
              onChange={(html, text) => {
                bodyHtmlRef.current = html;
                bodyTextRef.current = text;
                setHasBody(text.trim().length > 0);
              }}
            />
          </div>

          {/* 코칭 패널(검토 탭) */}
          {tab === 'review' && (
            <div className="flex flex-col gap-2 p-3 text-sm" data-testid="mail-coaching-panel">
              {coach.isPending && (
                <p className="text-muted-foreground" data-testid="mail-coaching-loading">
                  AI가 초안을 검토하는 중…
                </p>
              )}
              {coach.isError && (
                // 503(AI off·비서 미설정) 등 서버가 친화적 메시지를 내려주면 그 메시지를 우선 표시.
                // Axios 에러가 아니거나 response.data.message 가 없으면 일반 재시도 안내로 폴백.
                <p className="text-destructive" data-testid="mail-coaching-error">
                  {axios.isAxiosError(coach.error) &&
                  typeof (coach.error.response?.data as { message?: string })?.message === 'string' &&
                  (coach.error.response!.data as { message: string }).message
                    ? (coach.error.response!.data as { message: string }).message
                    : 'AI 검토에 실패했어요. 다시 시도해주세요.'}
                </p>
              )}
              {coach.data && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">전체 코칭</span>
                    {coach.data.notes.length === 0 ? (
                      <p className="text-muted-foreground" data-testid="mail-coaching-clean">
                        특별히 고칠 곳이 없어요. 보내셔도 좋아요.
                      </p>
                    ) : (
                      coach.data.notes.map((n: CoachingNote, i) => (
                        <div key={i} className="flex gap-2" data-testid="mail-coaching-note">
                          <span className="flex-none rounded bg-muted px-1.5 text-xs font-bold text-muted-foreground">
                            {dimensionLabel(n.dimension)}
                          </span>
                          <span className="text-foreground">{n.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                  {coach.data.improvedBodyHtml && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">다듬은 개선본</span>
                      {/* 스크립트 차단 iframe — LLM 생성 HTML 을 sandbox="" 로 격리해 XSS 방지. */}
                      <iframe
                        data-testid="mail-coaching-improved"
                        title="다듬은 개선본"
                        sandbox=""
                        srcDoc={coach.data.improvedBodyHtml}
                        className="min-h-[8rem] w-full rounded border border-border bg-muted/40"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid="mail-coaching-apply"
                          className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                          onClick={() => {
                            // 개선본 교체 → 본문이 바뀌므로 코칭 결과는 stale. reset 하고 다음 검토 진입 시 재실행.
                            composerRef.current?.setContent(coach.data!.improvedBodyHtml);
                            coach.reset();
                            lastCoachedRef.current = null;
                            setTab('compose');
                          }}
                        >
                          개선본으로 교체
                        </button>
                        <button
                          type="button"
                          data-testid="mail-coaching-keep"
                          className="rounded border border-border px-3 py-1 text-xs font-medium"
                          onClick={() => setTab('compose')}
                        >
                          그대로 두기
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 액션 */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              data-testid="mail-compose-send"
              onClick={onSend}
              disabled={send.isPending}
              className={cn(
                'flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
              )}
            >
              <Send className="h-4 w-4" />
              {send.isPending ? '전송 중…' : '보내기'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 코칭 차원 → 한글 짧은 라벨. */
function dimensionLabel(d: CoachingNote['dimension']): string {
  if (d === 'TONE') return '톤'
  if (d === 'CLARITY') return '명료'
  return '완결'
}
