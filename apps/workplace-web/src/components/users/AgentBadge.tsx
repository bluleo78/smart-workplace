// AGENT 시각 구분 배지 — Bot 아이콘 + "AGENT" 라벨, 보라색 톤.
// 사람(HUMAN) 과 분리해 인지 부하를 낮추기 위함. 다크 모드 색 별도 지정.

import { Bot } from 'lucide-react';

interface AgentBadgeProps {
  size?: 'sm' | 'xs';
}

export function AgentBadge({ size = 'sm' }: AgentBadgeProps) {
  const padding =
    size === 'xs' ? 'px-1 py-0 text-[10px]' : 'px-1.5 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded ${padding} bg-purple-200 text-purple-900 dark:bg-purple-900 dark:text-purple-100`}
      data-testid="agent-badge"
      aria-label="AGENT 사용자"
    >
      <Bot className="h-3 w-3" /> AGENT
    </span>
  );
}
