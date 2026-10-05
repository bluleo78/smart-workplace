// 모바일 타임라인 아젠다(WP-197) — 간트(가로 캔버스·드래그)는 390px 에서 읽기 어려워 월별 세로 목록으로 보여 준다.
// 상단 칩 줄 [기간 칩][필터 N][마일스톤 N][일정 미정 N] + 월 섹션(에픽 머리 행 아래 하위 들여쓰기) + 행마다 그 월 기준 미니 막대·오늘 선.
// 에픽은 기본 접힘 — 왼쪽 펼침 버튼으로 하위를 보고(진행률은 제목 옆 배지), 펼침 상태는 데스크톱 간트와 공유한다(WP-251).
// 데이터는 TimelinePage 가 이미 조회한 이슈(→ buildAgendaSections)·마일스톤 — 조회 추가 없음. 막대 드래그·마일스톤 편집은 범위 밖.
import { CalendarRange, ChevronDown, Diamond } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';

import { MobileEmptyState } from '@/components/mobile/MobileEmptyState';
import { MobileSheetShell } from '@/components/mobile/MobileSheetShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { formatDateMonthDay, formatDateRangeMonthDay } from '../../../lib/formatters';
import type { IssueResponse } from '../../../types/issue';
import type { MilestoneResponse } from '../../../types/milestone';
import { HIDE_SCROLLBAR, MOBILE_CHIP, MOBILE_CHIP_ACTIVE } from '../components/mobile/chipStyles';
import { MobileFilterSheet } from '../components/mobile/MobileFilterSheet';
import { type AgendaRow, buildAgendaSections, epicGroupKey } from './timelineData';
import { TimelineStatusBadge } from './TimelineStatusBadge';
import type { TimelineViewOptions } from './timelineTypes';
import { useTimelineExpanded } from './useTimelineExpanded';
import { useTimelineFilterControls } from './useTimelineFilterControls';

// 행 날짜 문구 — 둘 다 있으면 범위, 한쪽만 있으면 그 날짜, 없으면 「일정 미정」.
function rowDateText(r: AgendaRow): string {
  return formatDateRangeMonthDay(r.start, r.due, '일정 미정', { collapseSameDay: true });
}

// 월 비율 구간 → 막대 style. 월 밖으로 잘려 폭이 0 이어도 끝에 2px 막대가 남게 — left 는 트랙 안으로, width 는 최소 2px(Review Focus 2).
function spanStyle(span: { left: number; right: number }) {
  return {
    left: `min(${span.left * 100}%, calc(100% - 2px))`,
    width: `max(2px, ${(span.right - span.left) * 100}%)`,
  };
}

export function TimelineAgendaList({
  projectKey,
  issues,
  milestones,
  loading,
  onOpenIssue,
  view,
  periodChip,
  onShowAllPeriods,
}: {
  projectKey: string;
  /** TimelinePage 가 조회한 이슈 전량 — 아젠다 섹션은 여기서 파생(조회 추가 없음). */
  issues: IssueResponse[];
  milestones: MilestoneResponse[];
  /** 첫 로드·자동 다음 페이지 페치 중 — 이 동안은 빈 상태를 띄우지 않는다(깜빡임 방지). */
  loading: boolean;
  onOpenIssue: (issueNumber: number) => void;
  view: TimelineViewOptions;
  periodChip?: ReactNode;
  /** 기간 빈 상태의 「전체 기간 보기」 — 기간을 전체로 바꾼다. */
  onShowAllPeriods: () => void;
}) {
  // 아젠다 섹션 — 이 컴포넌트는 모바일에서만 마운트되므로 데스크톱에선 계산 자체가 일어나지 않는다.
  const sections = useMemo(() => buildAgendaSections(issues, new Date(), view), [issues, view]);
  const filter = useTimelineFilterControls(projectKey, { includeAssignee: true });
  const [sheet, setSheet] = useState<'filter' | 'milestones' | null>(null);
  const undatedRef = useRef<HTMLElement | null>(null);
  // 「일정 미정 N」 = 미정 섹션의 날짜 없는 이슈 수 — 접힌 에픽의 하위도 센다(행이 숨어도 일정이 없는 건 같다).
  const undatedCount = sections.find((s) => s.key === 'undated')?.rows.filter((r) => !r.start && !r.due).length ?? 0;
  const { isOpen, toggle } = useTimelineExpanded(projectKey);
  const groupKeyOf = (epicNumber: number | null) => (epicNumber == null ? null : epicGroupKey(epicNumber));
  const isEmpty = !loading && sections.length === 0;
  // 기간 빈 상태(WP-247) — 데스크톱(timeline-period-empty)과 같은 조건: 기간이 걸렸고 날짜 있는 섹션이 하나도 없으면.
  // 일정 미정 이슈는 기간과 무관하게 남으므로, 미정 섹션이 있으면 그 위에 안내를 두고 미정 섹션은 그대로 보인다.
  // 단, 기간이 원인일 때만 — 기간을 빼면 날짜 있는 섹션이 생길 때. 필터 0건·새 프로젝트면 기존(WP-197) 빈 상태 문구를 쓴다.
  const hasDated = sections.some((s) => s.key !== 'undated');
  const periodIsCause = useMemo(
    () => view.period != null && !hasDated && buildAgendaSections(issues, new Date(), { ...view, period: null }).some((s) => s.key !== 'undated'),
    [issues, view, hasDated],
  );
  const periodEmpty = !loading && periodIsCause;
  const periodEmptyState = (className?: string) => (
    <MobileEmptyState
      icon={CalendarRange}
      title="이 기간에 걸친 이슈가 없어요"
      description="기간을 「전체」로 바꿔 보세요"
      action={
        <Button variant="outline" className="min-h-11" data-testid="timeline-period-show-all" onClick={onShowAllPeriods}>
          전체 기간 보기
        </Button>
      }
      className={className}
      data-testid="timeline-agenda-empty"
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="timeline-agenda">
      {/* 칩 줄 — 「필터」는 항상(0건이어도 풀 수 있게), 마일스톤·일정 미정은 N>0 일 때만. 넘치면 가로 스크롤. */}
      <div className={cn('flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-4 py-2', HIDE_SCROLLBAR)}>
        {periodChip}
        <button
          type="button"
          data-testid="agenda-chip-filter"
          onClick={() => setSheet('filter')}
          className={cn(MOBILE_CHIP, filter.activeFilterCount > 0 && MOBILE_CHIP_ACTIVE)}
        >
          필터{filter.activeFilterCount > 0 && ` ${filter.activeFilterCount}`}
        </button>
        {milestones.length > 0 && (
          <button type="button" data-testid="agenda-chip-milestones" onClick={() => setSheet('milestones')} className={MOBILE_CHIP}>
            <Diamond className="size-3.5 text-ai-accent" aria-hidden />
            마일스톤 {milestones.length}
          </button>
        )}
        {undatedCount > 0 && (
          <button
            type="button"
            data-testid="agenda-chip-undated"
            onClick={() => undatedRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
            className={MOBILE_CHIP}
          >
            일정 미정 {undatedCount}
          </button>
        )}
      </div>

      {isEmpty && periodEmpty ? (
        periodEmptyState('flex-1')
      ) : isEmpty ? (
        <MobileEmptyState
          icon={CalendarRange}
          title="표시할 이슈가 없어요"
          description={filter.activeFilterCount > 0 ? '필터를 풀면 더 많은 이슈가 보여요.' : '진행할 이슈가 생기면 여기에 일정순으로 모여요. 취소된 이슈와 하위 태스크는 보이지 않아요.'}
          className="flex-1"
          data-testid="timeline-agenda-empty"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {periodEmpty && periodEmptyState('pt-10 pb-6')}
          {sections.map((sec) => (
            <section
              key={sec.key}
              ref={sec.key === 'undated' ? (el) => { undatedRef.current = el; } : undefined}
              data-testid={sec.key === 'undated' ? 'agenda-undated' : `agenda-month-${sec.key}`}
              aria-label={sec.label}
            >
              {/* 월 제목 — 스크롤 중에도 어느 달인지 보이게 sticky. */}
              <h2 className="sticky top-0 z-10 border-b bg-muted px-4 py-2 text-xs font-semibold text-muted-foreground">{sec.label}</h2>
              <ul>
                {sec.rows.map((r) => {
                  // 접힌 에픽의 하위 행은 그리지 않는다.
                  if (r.kind === 'child' && !isOpen(groupKeyOf(r.epicNumber))) return null;
                  const hasToggle = r.kind === 'epic' && r.hasChildren;
                  const open = isOpen(groupKeyOf(r.issueNumber));
                  return (
                    <li key={r.issueNumber} className="relative">
                      <button
                        type="button"
                        data-testid={`agenda-row-${r.issueNumber}`}
                        data-kind={r.kind}
                        onClick={() => onOpenIssue(r.issueNumber)}
                        // 왼쪽 펼침 버튼 자리(44px)만큼 모든 행을 같이 들인다. 하위는 제목·날짜 글자만 한 단 더 들이고 막대는
                        // 들이지 않는다 — 모든 행이 같은 월 트랙을 써야 날짜 위치·오늘 선이 행 사이에서 세로로 맞는다.
                        className="flex min-h-11 w-full flex-col gap-1.5 border-b py-2.5 pr-4 pl-11 text-left active:bg-accent"
                      >
                        <span
                          className={cn(
                            'line-clamp-2 text-sm',
                            r.kind === 'epic' && 'font-semibold',
                            r.kind === 'epic' && (r.status === 'DONE' ? 'text-success' : r.status === 'CANCELED' ? 'text-muted-foreground' : 'text-ai-accent'),
                            r.kind === 'child' && 'ml-4',
                          )}
                        >
                          {r.kind === 'epic' && <Diamond className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />}
                          <span className={cn(r.kind === 'epic' && r.status === 'CANCELED' && 'line-through')}>{r.title}</span>
                          {r.kind === 'epic' && <TimelineStatusBadge status={r.status} />}
                          {r.formerEpicTitle && <span className="ml-1 text-xs text-muted-foreground">← {r.formerEpicTitle}</span>}
                          {r.progress && r.progress.total > 0 && (
                            <span data-testid="agenda-progress" className="ml-1.5 inline-block rounded-full bg-ai-accent/10 px-1.5 align-[1px] text-xs font-semibold">
                              <span aria-hidden="true">{r.progress.done}/{r.progress.total}</span>
                              <span className="sr-only">하위 {r.progress.total}개 중 {r.progress.done}개 완료</span>
                            </span>
                          )}
                        </span>
                        {r.bar && (
                          // 막대 묶음 — 위: 자기 기간 막대, 아래(에픽만): 하위 실제 범위 얇은 막대. 오늘 선은 묶음 전체를 세로로 가로지른다.
                          <span className="relative flex flex-col gap-0.5" aria-hidden="true">
                            {/* 에픽 막대는 하위·일반 이슈(4px)보다 두껍게(6px) 해 위계를 드러낸다. */}
                            <span className={cn('relative block w-full rounded-full bg-muted', r.kind === 'epic' ? 'h-1.5' : 'h-1')}>
                              <span
                                data-testid="agenda-bar"
                                className={cn('absolute inset-y-0 rounded-full', r.kind === 'epic' ? (r.status === 'DONE' ? 'bg-success' : r.status === 'CANCELED' ? 'bg-muted-foreground/40' : 'bg-ai-accent') : 'bg-primary')}
                                style={spanStyle(r.bar)}
                              />
                            </span>
                            {/* 에픽 기간 밖으로 나간 하위 구간은 빨강(데스크톱 WP-249 와 같은 규칙). */}
                            {r.rollup && (
                              <span className="relative block h-0.75 w-full">
                                <span data-testid="agenda-rollup" className="absolute inset-y-0 rounded-full bg-destructive" style={spanStyle(r.rollup.bar)} />
                                {r.rollup.inside && (
                                  // 불투명하게 섞는다 — 반투명이면 아래 빨강이 비쳐 초과 구간과 경계가 흐려진다.
                                  <span
                                    data-testid="agenda-rollup-inside"
                                    className="absolute inset-y-0 rounded-full bg-[color-mix(in_oklab,var(--ai-accent)_70%,var(--background))]"
                                    style={spanStyle(r.rollup.inside)}
                                  />
                                )}
                              </span>
                            )}
                            {sec.todayRatio != null && (
                              <span
                                data-testid="agenda-today"
                                className="absolute -inset-y-1 w-px bg-destructive"
                                style={{ left: `min(${sec.todayRatio * 100}%, calc(100% - 1px))` }}
                              />
                            )}
                          </span>
                        )}
                        <span className={cn('text-xs text-muted-foreground', r.kind === 'child' && 'ml-4')}>
                          {rowDateText(r)}
                          {/* 막대는 aria-hidden 이라 하위 실제 범위·초과는 스크린리더에 글로 알린다(색만으로 전달 금지). */}
                          {r.rollup && (
                            <span className="sr-only">
                              {`, 하위 일정 ${formatDateRangeMonthDay(r.rollup.span.start, r.rollup.span.due, '', { collapseSameDay: true })}${r.rollup.overflow ? ' (에픽 기간 초과)' : ''}`}
                            </span>
                          )}
                        </span>
                      </button>
                      {hasToggle && (
                        <button
                          type="button"
                          data-testid={`agenda-toggle-${r.issueNumber}`}
                          aria-expanded={open}
                          aria-label={`${r.title} 하위 이슈 ${open ? '접기' : '펼치기'}`}
                          onClick={() => toggle(epicGroupKey(r.issueNumber), !open)}
                          className="absolute top-0 left-0 flex size-11 items-center justify-center text-muted-foreground active:bg-accent"
                        >
                          <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} aria-hidden />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <MobileFilterSheet open={sheet === 'filter'} onClose={() => setSheet(null)} controls={filter} />
      {/* 마일스톤 시트 — 읽기 전용(모바일 마일스톤 편집은 범위 밖). 마감일 오름차순. */}
      <MobileSheetShell
        open={sheet === 'milestones'}
        onClose={() => setSheet(null)}
        title="마일스톤"
        description="프로젝트 마일스톤 목록입니다."
        testId="agenda-milestone-sheet"
      >
        <ul className="min-h-0 flex-1 overflow-y-auto pb-3">
          {[...milestones]
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            .map((m) => (
              <li key={m.id} className="flex min-h-11 items-center gap-3 px-4 text-base">
                <Diamond className="size-4 shrink-0 text-ai-accent" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{formatDateMonthDay(m.dueDate)}</span>
              </li>
            ))}
        </ul>
      </MobileSheetShell>
    </div>
  );
}
