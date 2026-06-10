// AGENT 시각 구분 배지 — Bot 아이콘 + "AGENT" 라벨, 보라색 톤.
// 사람(HUMAN) 과 분리해 인지 부하를 낮추기 위함.
// #208: AI 정체성 색을 시맨틱 토큰 ai-accent 로 통일(홈 위젯과 동일 원본).
// 라이트/다크 값이 index.css 에 쌍으로 정의돼 있어 dark: 변형이 필요 없다.

import { Bot } from 'lucide-react';

interface AgentBadgeProps {
  size?: 'sm' | 'xs';
}

export function AgentBadge({ size = 'sm' }: AgentBadgeProps) {
  const padding =
    size === 'xs' ? 'px-1 py-0 text-[10px]' : 'px-1.5 py-0.5 text-xs';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded ${padding} bg-ai-accent-subtle text-ai-accent`}
      data-testid="agent-badge"
      aria-label="AGENT 사용자"
    >
      <Bot className="h-3 w-3" /> AGENT
    </span>
  );
}
