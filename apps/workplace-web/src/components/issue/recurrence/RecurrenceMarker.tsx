// AI 위임 작업 행의 반복 표식(WP-989) — 「↻ 매주 월·수 08:30」. 꺼진 반복은 뒤에 「· 꺼짐」.
import { Repeat } from 'lucide-react';

import { recurrenceLabel } from '@/lib/issueRecurrence';
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
  const text = recurrenceLabel(recurrence.rrule, recurrence.time) + (recurrence.enabled ? '' : ' · 꺼짐');
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
