// AI 진입 버튼 아이콘(WP-191) — ✦ + 상태 표시. 생성 중엔 반짝이고(동작 줄이기면 고정 점), 닫힌 사이 끝난 답변이 있으면 점.
// 테두리 회전(.ai-ring)은 호스트 모양(캡슐·원·칩)에 따라 달라 호스트가 붙인다. 이 컴포넌트를 감싸는 호스트는 relative 여야 한다.
import { Sparkles } from 'lucide-react';

import { AiStatusDot } from '@/components/ai/AiStatusDot';
import type { AiActivity } from '@/lib/ai/aiActivity';
import { cn } from '@/lib/utils';

/** 생성 중 ✦ 반짝임(동작 줄이기면 적용 안 됨). AiSparkle·세션 목록 상태 줄이 공유한다. */
export const AI_TWINKLE_CLASS = 'motion-safe:animate-[ai-twinkle_1.1s_ease-in-out_infinite]';

export function AiSparkle({
  activity,
  className,
  dotClassName,
}: {
  activity: AiActivity;
  /** 아이콘 크기·색 */
  className?: string;
  /** 점 위치(호스트 기준 absolute) */
  dotClassName?: string;
}) {
  const pending = activity === 'pending';
  return (
    <>
      <Sparkles
        aria-hidden
        className={cn(className, pending && AI_TWINKLE_CLASS)}
      />
      {/* done: 항상 점 / pending: 동작 줄이기일 때만 점(움직임 대체) */}
      {(activity === 'done' || pending) && (
        <AiStatusDot
          data-testid="ai-trigger-dot"
          className={cn(pending && 'hidden motion-reduce:block', dotClassName)}
        />
      )}
    </>
  );
}
