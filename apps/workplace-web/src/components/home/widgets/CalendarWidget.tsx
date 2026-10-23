import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents';
import { resolveCalendarRange } from '@/lib/calendarRange';
import { formatLocalClockTime24 } from '@/lib/formatters';
import { showsLoadError } from '@/lib/queryFailure'
import type { CalendarEvent } from '@/types/calendar';

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

/**
 * #460: 캘린더 위젯 — show_calendar 위젯 지시를 받아 지정 범위의 일정 목록을 표시한다.
 * params: { from?, to? }. 미지정 시 오늘 00:00~24:00 를 기본 범위로 사용.
 * 항목 클릭 시 /calendar 딥링크.
 */
export default function CalendarWidget({
  params,
  previewData,
}: {
  params?: Record<string, unknown>
  previewData?: CalendarEvent[]
}) {
  const { from, to } = resolveCalendarRange(params);

  const query = useCalendarEvents(from, to, { enabled: !previewData });
  const { data: queryData, isLoading, refetch } = query;
  const data = previewData ?? queryData;

  // 실패 안내는 로딩보다 먼저 본다 — 다시 부르는 동안에도 안내를 그대로 둬야 다시 시도의 초점이 남는다(WP-881).
  if (!previewData && showsLoadError(query)) {
    return (
      <WidgetFrame title="일정">
        <WidgetError onRetry={() => refetch()} retrying={query.isFetching} testId="calendar-error" />
      </WidgetFrame>
    );
  }

  if (!previewData && isLoading) {
    return (
      <WidgetFrame title="일정">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    );
  }

  const items = data ?? [];
  return (
    <WidgetFrame title="일정">
      {items.length > 0 ? (
        <ul className="divide-y" data-testid="calendar-items">
          {items.map((ev) => (
            <li key={`${ev.id}-${ev.occurrenceDate ?? ev.startsAt}`}>
              {/* 일정 클릭 시 캘린더 페이지로 딥링크. 추후 상세 라우트 추가 시 교체 가능. */}
              <Link
                to="/calendar"
                aria-label={`일정 열기: ${ev.title}`}
                className="flex items-center gap-2 py-2 text-sm hover:text-ai-accent"
              >
                <span className="w-12 shrink-0 text-xs text-muted-foreground">
                  {ev.allDay ? '종일' : formatLocalClockTime24(ev.startsAt)}
                </span>
                <span className="flex-1 truncate">{ev.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="calendar-empty"
        >
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">일정이 없어요</p>
          <p className="max-w-xs text-xs text-muted-foreground">이 기간에 등록된 일정이 없습니다.</p>
        </div>
      )}
    </WidgetFrame>
  );
}
