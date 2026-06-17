// Gmail식 우하단 도킹 작성창. 최소화/복원/닫기. 보내기 = useSendMail.
// MailComposeProvider 의 draft 가 있으면 렌더, 없으면 null.

import { Minus, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { useSendMail } from '../../hooks/queries/useMailMessages';
import { useMailCompose } from './MailComposeContext';
import { MailComposer } from './MailComposer';

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
  }, [draft]);

  if (!draft) return null;

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
          {/* 본문 */}
          <MailComposer
            key={draft.instanceId}
            initialHtml={draft.initialHtml}
            onChange={(html, text) => {
              bodyHtmlRef.current = html;
              bodyTextRef.current = text;
            }}
          />
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
