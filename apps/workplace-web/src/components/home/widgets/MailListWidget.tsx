import { Mail, Paperclip } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { useMailAccounts } from '@/hooks/queries/useMailAccounts';
import { useMailMessages } from '@/hooks/queries/useMailMessages';
import type { EmailMessageSummary, MailFolder } from '@/types/mailMessage';

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

// 발신자 표시명 — name 우선, 없으면 주소, 둘 다 없으면 '(알 수 없음)'.
function sender(m: EmailMessageSummary): string {
  return m.fromName?.trim() || m.fromAddress || '(알 수 없음)';
}

// 수신 일시 → MM/DD. null 이면 빈 문자열(표 정렬 깨짐 방지).
function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// 메시지 목록 행 마크업 — 실데이터 렌더와 프리뷰(previewData) 렌더가 공유.
function MessageRows({ items }: { items: EmailMessageSummary[] }) {
  return (
    <ul className="divide-y" data-testid="maillist-items">
      {items.map((m) => (
        <li key={m.id}>
          {/* 메시지 전용 상세 라우트가 없어 메일함(/mail)으로 딥링크(UnreadMailBody 와 동일 폴백). */}
          <Link
            to="/mail"
            aria-label={`메일 열기: ${m.subject?.trim() || '(제목 없음)'}`}
            className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
          >
            {/* 미읽음 표식 — ai-accent 점. 읽음이면 자리만 차지(정렬 유지). */}
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${m.seen ? 'bg-transparent' : 'bg-ai-accent'}`}
            />
            <span className="w-10 shrink-0 text-xs text-muted-foreground">
              {shortDate(m.receivedAt)}
            </span>
            <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
              {sender(m)}
            </span>
            <span className={`flex-1 truncate ${m.seen ? '' : 'font-medium'}`}>
              {m.subject?.trim() || '(제목 없음)'}
            </span>
            {m.hasAttachment && (
              <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-label="첨부 있음" />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// 메일 없음 빈 상태 — 실데이터/프리뷰 공유.
function EmptyState({ title }: { title: string }) {
  return (
    <div
      className="flex flex-col items-center gap-2 px-4 py-8 text-center"
      data-testid="maillist-empty"
    >
      <Mail className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-semibold">메일이 없어요</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        {title}에 표시할 메일이 없습니다.
      </p>
    </div>
  );
}

/**
 * #431: 메일 목록 위젯 — show_mail_list 위젯 지시를 받아 받은편지함 목록을 표시한다.
 * LLM 이 20행 마크다운 표를 토큰으로 생성하던 비용(약 2,500토큰/50초)을 클라이언트 렌더로 대체.
 * params: { accountId?, folder?, query?, unreadOnly?, limit? }. accountId 미지정 시 첫 계정을 기본으로 해석한다.
 * previewData 가 있으면(위젯 카탈로그 미리보기) 계정/메시지 훅을 모두 비활성화하고 바로 렌더한다.
 */
export default function MailListWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: EmailMessageSummary[]
}) {
  const folder = ((params?.folder as string) || 'INBOX') as MailFolder;
  const query = (params?.query as string) || '';
  // #469: unreadOnly=true 면 안 읽은 메일만 표시(AI 가 "안 읽은 메일" 위젯 요청 시 사용).
  const unreadOnly = params?.unreadOnly === true;
  const limit = typeof params?.limit === 'number' ? params.limit : 20;

  const accounts = useMailAccounts({ enabled: !previewData });
  // accountId 가 지정되면 그대로, 아니면 첫 계정. 계정 로딩 전엔 undefined(목록 쿼리 비활성).
  const accountId =
    (params?.accountId as number | undefined) ?? accounts.data?.[0]?.id ?? undefined;
  const messages = useMailMessages(accountId, folder, query, unreadOnly, '', false, {
    enabled: !previewData,
  });

  const title = folder === 'SENT' ? '보낸편지함' : '받은편지함';

  // 프리뷰 데이터가 있으면 계정 로딩/에러/미설정 분기를 모두 건너뛰고 바로 콘텐츠를 렌더한다.
  if (previewData) {
    return (
      <WidgetFrame title={title}>
        {previewData.length > 0 ? (
          <MessageRows items={previewData.slice(0, limit)} />
        ) : (
          <EmptyState title={title} />
        )}
      </WidgetFrame>
    );
  }

  // 계정 목록 또는 메시지 목록 로딩 — 스켈레톤.
  if (accounts.isLoading || (accountId && messages.isLoading)) {
    return (
      <WidgetFrame title={title}>
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    );
  }
  // fetch 실패 — 거짓 빈 상태 대신 에러+재시도(#205).
  if (accounts.isError) {
    return (
      <WidgetFrame title={title}>
        <WidgetError onRetry={() => accounts.refetch()} testId="maillist-error" />
      </WidgetFrame>
    );
  }
  // 메일 계정 미등록 — 설정 안내.
  if (!accountId) {
    return (
      <WidgetFrame title={title}>
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="maillist-no-account"
        >
          <Mail className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">연결된 메일 계정이 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">메일 화면에서 계정을 추가해 보세요.</p>
        </div>
      </WidgetFrame>
    );
  }
  if (messages.isError) {
    return (
      <WidgetFrame title={title}>
        <WidgetError onRetry={() => messages.refetch()} testId="maillist-error" />
      </WidgetFrame>
    );
  }

  const items = (messages.data ?? []).slice(0, limit);
  return (
    <WidgetFrame title={title}>
      {items.length > 0 ? <MessageRows items={items} /> : <EmptyState title={title} />}
    </WidgetFrame>
  );
}
