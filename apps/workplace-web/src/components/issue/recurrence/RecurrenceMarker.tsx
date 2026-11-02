// AI 위임 작업 행의 반복 표식(WP-989) — 「↻ 매주 월·수 08:30」. 꺼진 반복은 뒤에 「· 꺼짐」, 실행을 마친 한 번만 예약(WP-1315)은 「· 실행함」.
import { Repeat } from 'lucide-react';

import { recurrenceLabel, recurrencePausedText } from '@/lib/issueRecurrence';
import { cn } from '@/lib/utils';
import type { IssueRecurrenceSummary } from '@/types/issueRecurrence';

export function RecurrenceMarker({
  recurrence,
  className,
  'data-testid': testId,
}: {
  recurrence: IssueRecurrenceSummary;
  className?: string;
  'data-testid'?: string;
}) {
  // 꺼진 일정은 뒤에 짧은 상태(첫 낱말 — 「꺼짐」·「멈춤」·「실행함」)를 붙인다.
  const paused = recurrencePausedText(recurrence)?.split(' ')[0];
  const text = recurrenceLabel(recurrence.rrule, recurrence.time) + (paused ? ` · ${paused}` : '');
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground', className)}
      title={`반복 ${text}`}
      data-testid={testId}
    >
      <Repeat className="h-3 w-3 shrink-0" aria-label="반복" />
      {text}
    </span>
  );
}
