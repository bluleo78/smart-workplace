// src/components/ai/ActionResultLine.tsx
// #843: 확인카드 처리 결과 한 줄 — 대화 이력의 ACTION_* 메시지를 말풍선이 아닌 시스템 기록으로 표시한다.
// 승인 결과는 AI 판단이 아니라 확정된 사실이라 AI 마커를 붙이지 않고, 성공은 --success 토큰을 쓴다(디자인시스템 07 §7.2).
import { CircleCheck, CircleMinus, CircleX } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ActionOutcome } from '@/types/home';

const ICON = {
  done: { Icon: CircleCheck, className: 'text-success', label: '승인 완료' },
  failed: { Icon: CircleX, className: 'text-destructive', label: '승인 실패' },
  rejected: { Icon: CircleMinus, className: 'text-muted-foreground', label: '거절됨' },
} as const satisfies Record<ActionOutcome, unknown>;

/**
 * 결과 줄. 색만으로 상태를 구분하지 않도록 본문 접두어("승인 완료:", "승인 실패:", "사용자가 거절:")는 서버 문구 그대로 유지한다.
 * 긴 실패 사유가 좁은 패널(≈380px)에서 넘치지 않도록 본문은 강제 줄바꿈하고, 아이콘은 첫 줄에 맞춘다.
 */
export function ActionResultLine({ outcome, content }: { outcome: ActionOutcome; content: string }) {
  const { Icon, className, label } = ICON[outcome];
  return (
    <div
      className="flex w-full items-start gap-1.5 px-1 text-xs text-muted-foreground"
      data-testid="action-result"
      data-status={outcome}
    >
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', className)} aria-label={label} />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{content}</span>
    </div>
  );
}
