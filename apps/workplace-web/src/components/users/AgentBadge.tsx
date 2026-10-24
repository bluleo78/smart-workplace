// AGENT 시각 구분 배지 — Bot 아이콘 + "에이전트" 라벨, 보라색 톤.
// 사람(HUMAN) 과 분리해 인지 부하를 낮추기 위함.
// #208: AI 정체성 색을 시맨틱 토큰 ai-accent 로 통일(홈 위젯과 동일 원본).
// 라이트/다크 값이 index.css 에 쌍으로 정의돼 있어 dark: 변형이 필요 없다.

import { Bot } from 'lucide-react';

import { cn } from '@/lib/utils';

interface AgentBadgeProps {
  size?: 'sm' | 'xs';
  /** 놓이는 자리에 맞춘 여백·정렬(예: 글줄 안 인박스 행의 ml-1 align-middle). */
  className?: string;
}

export function AgentBadge({ size = 'sm', className }: AgentBadgeProps) {
  const padding =
    size === 'xs' ? 'px-1 py-0 text-xs' : 'px-1.5 py-0.5 text-xs';
  return (
    <span
      // shrink-0/whitespace-nowrap — flex 컨테이너 폭이 부족할 때 배지 자체가 축소·줄바꿈되는 것을 방지(#711).
      className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-ai-accent-subtle text-ai-accent', padding, className)}
      data-testid="agent-badge"
      aria-label="에이전트 사용자"
    >
      <Bot className="h-3 w-3" /> 에이전트
    </span>
  );
}

/**
 * 행위자(알림을 일으킨 주체)가 AI 에이전트(AGENT)면 이름 뒤에 붙는 에이전트 배지 — 아니면 아무것도 그리지 않는다(WP-935).
 * 인박스 알림 행과 홈 알림 위젯이 함께 써서 표식을 맞춘다. 디자인 시스템 07 §7.2: 에이전트 주체는 늘 Bot 아이콘.
 * 예전 「AI」 칩은 이름에 이미 "AI" 가 있으면 「My AI AI」 중복이라 생략했지만(#636·#637), Bot+「에이전트」 배지는 그런 중복이 없어 늘 붙인다.
 */
export function AgentActorBadge({
  kind,
  className,
}: {
  /** 행위자 종류(NotificationResponse.actorKind 등) — 'AGENT' 일 때만 배지를 그린다. */
  kind: string | null | undefined;
  className?: string;
}) {
  if (kind !== 'AGENT') return null;
  return <AgentBadge size="xs" className={className} />;
}
