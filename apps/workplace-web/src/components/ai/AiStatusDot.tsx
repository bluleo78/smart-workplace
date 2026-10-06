// AI 상태 점(WP-190/191) — 완료·다른 대화 활동을 알리는 작은 ai-accent 점. 호스트(relative) 기준 absolute 로 놓이므로
// 위치는 className 으로 넘긴다. AiSparkle·세션 전환 버튼(패널/모바일 시트)이 같은 모양을 쓰도록 한곳에 둔다.
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function AiStatusDot({ className, ...rest }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute h-2 w-2 rounded-full bg-ai-accent ring-2 ring-background', className)}
      {...rest}
    />
  );
}
