// 이슈 채팅 접기 패널 — 자동/수동 토글 + localStorage 영속.
// 무엇을: recentMessages 있으면 자동 펼침, 없으면 접힘. 수동 토글은 이슈별 key 로 기억.
// 왜: 채팅(실시간·AI)과 코멘트(기록)를 분리하되, 안 쓸 땐 본문에 공간을 양보(#343).

import { MessageSquare, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useChatThread } from '@/hooks/queries/useChatThread';
import { usePersistentToggle } from '@/hooks/usePersistentToggle';

import { IssueChatSection } from './IssueChatSection';

// 로딩 중 시각 바 — thread 정착 전이므로 testid/onClick 없음(클릭 비결정성 방지).
// 무엇을: isLoading 동안 흰 빈 공간 대신 얇은 바를 보여 레이아웃 안정성 유지.
function LoadingRail() {
  return (
    <div
      aria-label="채팅 로딩 중"
      aria-busy="true"
      className="flex w-9 shrink-0 flex-col items-center gap-2 rounded border py-3 text-xs font-semibold text-muted-foreground [writing-mode:vertical-rl]"
    >
      <MessageSquare className="h-4 w-4" />
      채팅
    </div>
  );
}

// 접힘 상태 — 얇은 세로 토글 바.
// 무엇을: 채팅 패널이 접혔을 때 세로 버튼으로 클릭 시 펼침.
// 왜: 본문 너비를 최대화하면서 채팅 접근성을 유지.
function ChatRail({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      data-testid="issue-chat-panel-open"
      onClick={onOpen}
      aria-label="채팅 열기"
      className="flex w-9 shrink-0 flex-col items-center gap-2 rounded border py-3 text-xs font-semibold text-primary [writing-mode:vertical-rl] hover:bg-muted"
    >
      <MessageSquare className="h-4 w-4" />
      채팅
    </button>
  );
}

// 패널 본체 — thread 로드 완료 후에만 마운트(key 재마운트).
// 무엇을: usePersistentToggle(key, hasMessages) 를 thread 준비 후 초기화해 자동 판정 타이밍 보정.
// 왜: 훅 초기화 시점에 hasMessages 가 확정값이어야 localStorage 미기록 시 올바른 default 를 받음.
function ChatPanelInner({
  projectKey,
  issueNumber,
  hasMessages,
}: {
  projectKey: string;
  issueNumber: number;
  hasMessages: boolean;
}) {
  const storageKey = `issue-chat-panel:${projectKey}-${issueNumber}`;
  const [open, , set] = usePersistentToggle(storageKey, hasMessages);

  if (!open) {
    return <ChatRail onOpen={() => set(true)} />;
  }

  return (
    <aside
      data-testid="issue-chat-panel-body"
      className="w-full shrink-0 border-l pl-4 lg:w-[320px]"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
          <MessageSquare className="h-4 w-4" /> 채팅
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="채팅 접기"
          data-testid="issue-chat-panel-collapse"
          onClick={() => set(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <IssueChatSection projectKey={projectKey} issueNumber={issueNumber} />
    </aside>
  );
}

// 이슈 채팅 패널 — thread 로딩 전/후 분기.
// 무엇을: isLoading 동안 LoadingRail 표시, 완료 후 ChatPanelInner 를 key 로 마운트.
// 왜: key 로 마운트 타이밍을 제어해 usePersistentToggle 의 default(hasMessages) 초기화를 보장.
export function IssueChatPanel({
  projectKey,
  issueNumber,
}: {
  projectKey: string;
  issueNumber: number;
}) {
  const threadQ = useChatThread(projectKey, issueNumber);

  // thread 로딩 전에는 시각 바만 — 자동 판정 확정 전 깜빡임 방지.
  if (threadQ.isLoading) {
    return <LoadingRail />;
  }

  const hasMessages = (threadQ.data?.recentMessages?.length ?? 0) > 0;

  return (
    <ChatPanelInner
      key={`${projectKey}-${issueNumber}`}
      projectKey={projectKey}
      issueNumber={issueNumber}
      hasMessages={hasMessages}
    />
  );
}
