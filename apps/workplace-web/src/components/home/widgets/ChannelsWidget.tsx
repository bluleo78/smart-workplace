import { MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyChannels } from '@/hooks/queries/useMyChannels';

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

// 채널 kind → 한국어 배지 라벨.
function kindLabel(kind: string): string {
  return kind === 'DM' ? 'DM' : '채널';
}

/**
 * #460: 채널 목록 위젯 — show_channels 위젯 지시를 받아 내가 속한 채널 목록을 표시한다.
 * LLM 이 텍스트로 목록을 생성하는 비용을 클라이언트 렌더로 대체.
 * params: {} (필터 없음). 처음 20개만 표시.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ChannelsWidget({ params: _params }: { params?: Record<string, unknown> }) {
  const channels = useMyChannels();

  // 로딩 중 — 스켈레톤.
  if (channels.isLoading) {
    return (
      <WidgetFrame title="채널 목록">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    );
  }

  // fetch 실패 — 에러 + 재시도.
  if (channels.isError) {
    return (
      <WidgetFrame title="채널 목록">
        <WidgetError onRetry={() => channels.refetch()} testId="channels-error" />
      </WidgetFrame>
    );
  }

  // 최대 20개만 표시(토큰 절감 및 뷰 간결화).
  const items = (channels.data ?? []).slice(0, 20);

  return (
    <WidgetFrame title="채널 목록">
      {items.length > 0 ? (
        <ul className="divide-y" data-testid="channels-items">
          {items.map((ch) => (
            <li key={ch.id}>
              {/* DM은 /chat/dms/:id, 채널은 /chat/channels/:id 라우트로 분기(App.tsx 참조) */}
              <Link
                to={ch.kind === 'DM' ? `/chat/dms/${ch.id}` : `/chat/channels/${ch.id}`}
                aria-label={`채널 열기: ${ch.name}`}
                className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate">{ch.name}</span>
                {/* 채널 종류 배지 — CHANNEL / DM 구분 */}
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {kindLabel(ch.kind)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="channels-empty"
        >
          {/* h-8 w-8 — 빈 상태 아이콘 표준 크기. MailListWidget 빈 상태와 동일하게 맞춤 */}
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">채널이 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            참여한 채널이 없습니다. 채팅 화면에서 채널에 참여해 보세요.
          </p>
        </div>
      )}
    </WidgetFrame>
  );
}
