import { MapPin } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useCalendarEvent } from '@/hooks/queries/useCalendarEvent';
import { formatDateMonthDay, formatLocalClockTime24 } from '@/lib/formatters';
import { showsLoadError } from '@/lib/queryFailure';

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

// 일정 기간 텍스트 — 날짜 + 시각(allDay 면 날짜만).
function formatRange(startsAt: string, endsAt: string, allDay: boolean): string {
  const startDate = formatDateMonthDay(startsAt);
  if (allDay) return startDate;
  const startTime = formatLocalClockTime24(startsAt);
  const endTime = formatLocalClockTime24(endsAt);
  const endDate = formatDateMonthDay(endsAt);
  if (startDate === endDate) return `${startDate} ${startTime} – ${endTime}`;
  return `${startDate} ${startTime} – ${endDate} ${endTime}`;
}

/**
 * #460: 단일 일정 상세 위젯 — show_event 위젯 지시를 받아 특정 일정 상세를 표시한다.
 * params: { eventId }. eventId 누락 시 WidgetError.
 */
export default function EventWidget({ params }: { params?: Record<string, unknown> }) {
  const eventId = typeof params?.eventId === 'number' ? params.eventId : undefined;

  const query = useCalendarEvent(eventId);
  const { data, isLoading, refetch } = query;

  // eventId 누락 — 정적 파라미터 오류: 재시도 버튼 없이 안내 메시지만 표시.
  if (eventId === undefined) {
    return (
      <WidgetFrame title="일정 상세">
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="event-error"
        >
          <p className="text-sm font-semibold">일정 ID가 없습니다</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            일정 ID를 지정하여 다시 요청해 보세요.
          </p>
        </div>
      </WidgetFrame>
    );
  }

  // 실패 안내는 로딩보다 먼저 본다 — 다시 부르는 동안에도 안내를 그대로 둬야 다시 시도의 초점이 남는다(WP-881).
  // 로딩이 끝났는데 데이터가 없는 경우(!data)도 같은 실패 안내로 둔다 — 그 판정은 로딩 뒤에 해야 스켈레톤을 가리지 않는다.
  if (showsLoadError(query) || (!isLoading && !data)) {
    return (
      <WidgetFrame title="일정 상세">
        <WidgetError onRetry={() => refetch()} retrying={query.isFetching} testId="event-error" />
      </WidgetFrame>
    );
  }

  if (isLoading || !data) {
    return (
      <WidgetFrame title="일정 상세">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    );
  }

  return (
    <WidgetFrame title="일정 상세">
      <div className="space-y-2 p-2 text-sm" data-testid="event-detail">
        {/* 제목 */}
        <p className="font-semibold">{data.title}</p>
        {/* 기간 */}
        <p className="text-xs text-muted-foreground">
          {formatRange(data.startsAt, data.endsAt, data.allDay)}
        </p>
        {/* 장소 */}
        {data.location && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" aria-hidden />
            {data.location}
          </p>
        )}
        {/* 설명 */}
        {data.description && (
          <p className="whitespace-pre-wrap text-xs">{data.description}</p>
        )}
      </div>
    </WidgetFrame>
  );
}
