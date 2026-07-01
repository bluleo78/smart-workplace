import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { useCalendarEvents } from '@/hooks/queries/useCalendarEvents';

import { WidgetError } from './WidgetError';
import { WidgetFrame } from './WidgetFrame';

// from/to 범위를 ISO datetime 으로 정규화한다(#460).
// AI 가 show_calendar 에 date-only("2026-06-22") 를 줄 수 있으나, 백엔드 /calendar/events 는
// @DateTimeFormat(ISO.DATE_TIME) OffsetDateTime 을 요구하므로 date-only 를 그대로 보내면 400 이 난다.
// from = 시작일 00:00, to = 종료일 +1일 00:00(종료일 포함 = exclusive end). 미지정 시 오늘.
// from==to(단일일)·to 미지정·역전 범위 모두 최소 하루 범위로 보정해 빈 범위를 방지한다.
// params.range('today'|'week')는 홈 대시보드 카탈로그 위젯(catalogRegistry)의 "기간" 필터가 보내는 상대 범위 —
// "오늘"은 from/to 미지정과 동일 효과, "week"는 오늘부터 7일 범위. 렌더 시점 기준으로 매번 계산해 정적 옵션값이 낡지 않게 한다.
function resolveRange(params?: Record<string, unknown>): { from: string; to: string } {
  // 문자열(date-only 또는 ISO)을 그 날 로컬 00:00 Date 로 파싱. 유효하지 않으면 null.
  const startOfDay = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !v.trim()) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const fromDate = startOfDay(params?.from) ?? today;
  let toDay = startOfDay(params?.to) ?? fromDate;
  if (params?.range === 'week' && !params?.to) {
    toDay = new Date(fromDate);
    toDay.setDate(toDay.getDate() + 6);
  }
  // 종료일을 포함하도록 +1일. 역전(to<from) 시 from 기준으로 보정.
  const toExclusive = new Date(Math.max(toDay.getTime(), fromDate.getTime()));
  toExclusive.setDate(toExclusive.getDate() + 1);
  return { from: fromDate.toISOString(), to: toExclusive.toISOString() };
}

// 일정 시작시각을 로컬 HH:mm 으로 포맷.
function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * #460: 캘린더 위젯 — show_calendar 위젯 지시를 받아 지정 범위의 일정 목록을 표시한다.
 * params: { from?, to? }. 미지정 시 오늘 00:00~24:00 를 기본 범위로 사용.
 * 항목 클릭 시 /calendar 딥링크.
 */
export default function CalendarWidget({ params }: { params?: Record<string, unknown> }) {
  const { from, to } = resolveRange(params);

  const { data, isLoading, isError, refetch } = useCalendarEvents(from, to);

  if (isLoading) {
    return (
      <WidgetFrame title="일정">
        <Skeleton className="h-24 w-full" />
      </WidgetFrame>
    );
  }

  if (isError) {
    return (
      <WidgetFrame title="일정">
        <WidgetError onRetry={() => refetch()} testId="calendar-error" />
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
                  {ev.allDay ? '종일' : shortTime(ev.startsAt)}
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
