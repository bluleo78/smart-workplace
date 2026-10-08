// 데스크톱 타임라인 본문 — 필터바·간트·일정 미정 섹션. TimelinePage 에서 분리해 데스크톱(≥1024px)에서만 마운트한다.
// 왜: 의존성 조회·에픽 그룹/화살표 계산은 간트 전용이라, 모바일 아젠다(WP-197)에선 돌 필요가 없다.
// 이슈 전량·마일스톤·자동 다음 페이지 페치·마일스톤 다이얼로그/팝오버 상태는 모바일과 공유하므로 TimelinePage 가 소유한다.
// 빈 상태(WP-247): 조회 기간에 걸친 일정 있는 이슈가 없으면 빈 상태 표시. 일정 미정 이슈는 항상 표시되므로 unscheduled 개수는 확인하지 않는다.
import { CalendarRange } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { pageGutterClass } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CycleResponse } from '@/types/cycle';

import { useProjectDependencies } from '../../../hooks/queries/useProjectDependencies';
import { useTimelineIssueUpdate } from '../../../hooks/queries/useTimelineIssueUpdate';
import type { IssueResponse } from '../../../types/issue';
import type { MilestoneResponse } from '../../../types/milestone';
import {
  cyclesToBands,
  defaultScheduleRange,
  filterRenderableDependencies,
  groupTimelineIssues,
  milestonesToMarkers,
} from './timelineData';
import { TimelineFilterBar } from './TimelineFilterBar';
import { TimelineGantt, type TimelineZoom } from './TimelineGantt';
import type { TimelineViewOptions } from './timelineTypes';
import { UnscheduledSection } from './UnscheduledSection';
import { useTimelineExpanded } from './useTimelineExpanded';

export function TimelineGanttBody({
  projectKey: key,
  issues,
  milestones,
  zoom,
  scrollToDate,
  readOnly,
  onMilestoneClick,
  onLaneClick,
  view,
  periodPicker,
  loading,
  cycles,
  onShowAllPeriods,
}: {
  projectKey: string;
  issues: IssueResponse[];
  milestones: MilestoneResponse[] | undefined;
  zoom: TimelineZoom;
  scrollToDate: string | undefined;
  readOnly: boolean;
  /** 다이아몬드 클릭 — 편집 팝오버 상태는 TimelinePage 가 든다. */
  onMilestoneClick: (milestone: MilestoneResponse, anchorRect: DOMRect) => void;
  /** 빈 레인 클릭 — 해당 날짜로 마일스톤 생성 다이얼로그(읽기 전용 판단은 여기서). */
  onLaneClick: (date: string) => void;
  view: TimelineViewOptions;
  periodPicker?: ReactNode;
  loading?: boolean;
  /** 사이클 목록 — 기간 훅(useTimelinePeriod)이 이미 조회한 것을 받아 밴드만 그린다(같은 조회를 두 번 하지 않는다). */
  cycles: CycleResponse[];
  /** 기간 빈 상태의 「전체 기간 보기」 — 기간을 전체로 바꾼다. */
  onShowAllPeriods: () => void;
}) {
  const navigate = useNavigate();
  const dependencies = useProjectDependencies(key);
  const updateIssue = useTimelineIssueUpdate(key);

  // 에픽 계층 트리(#649) — bars 평면 목록 대신 에픽 그룹 트리로 변환.
  const { groups, unscheduled } = useMemo(() => groupTimelineIssues(issues, view), [issues, view]);
  // 기간 빈 상태는 기간이 원인일 때만(WP-247) — 기간을 빼면 그릴 막대가 있을 때. 필터 0건·새 프로젝트는 「전체」로 바꿔도
  // 달라지지 않으므로 기존 빈 간트를 그대로 둔다. 기간 결과가 비었을 때만 한 번 더 계산한다.
  const { includeCanceled } = view;
  const periodIsCause = useMemo(
    () => view.period != null && groups.length === 0 && groupTimelineIssues(issues, { includeCanceled }).groups.length > 0,
    [issues, includeCanceled, view.period, groups.length],
  );
  const cycleBands = useMemo(() => cyclesToBands(cycles), [cycles]);
  const milestoneMarkers = useMemo(() => milestonesToMarkers(milestones ?? []), [milestones]);
  // 일정 미정/CANCELED 이슈로의 화살표는 SVAR 가 렌더할 노드가 없어 제외한다.
  const renderableDependencies = useMemo(
    () => filterRenderableDependencies(dependencies.data ?? [], groups.flatMap((g) => g.bars)),
    [dependencies.data, groups],
  );

  // 에픽 그룹 펼침 상태 — 모바일 아젠다와 공유(useTimelineExpanded). TimelineGantt 는 props 로만 주고받는다.
  const { expandedKeys, toggle: handleToggleGroup } = useTimelineExpanded(key);

  return (
    <>
      <div className={cn('border-b py-1', pageGutterClass)}>
        <TimelineFilterBar projectKey={key} leading={periodPicker} />
      </div>
      <div className={cn('min-h-0 flex-1 py-6', pageGutterClass)} data-testid="timeline-gantt">
        {!loading && periodIsCause ? (
          <div data-testid="timeline-period-empty" className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
            <CalendarRange className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium">이 기간에 걸친 이슈가 없어요</p>
              <p className="text-xs text-muted-foreground">기간을 「전체」로 바꿔 보세요</p>
            </div>
            <Button size="sm" variant="outline" data-testid="timeline-period-show-all" onClick={onShowAllPeriods}>
              전체 기간 보기
            </Button>
          </div>
        ) : (
          <TimelineGantt
            groups={groups}
            expandedKeys={expandedKeys}
            onToggleGroup={handleToggleGroup}
            milestones={milestoneMarkers}
            cycles={cycleBands}
            dependencies={renderableDependencies}
            zoom={zoom}
            readOnly={readOnly}
            scrollToDate={scrollToDate}
            onBarChange={(issueNumber, change) =>
              updateIssue.mutateAsync({
                number: issueNumber,
                data: { startDate: change.startDate, dueDate: change.dueDate },
              })
            }
            onBarClick={(issueNumber) => navigate(`/projects/${key}/issues/${issueNumber}`)}
            onMilestoneClick={(id, anchorRect) => {
              const target = milestones?.find((m) => m.id === id);
              if (target) onMilestoneClick(target, anchorRect);
            }}
            onLaneClick={(date) => {
              if (readOnly) return;
              onLaneClick(date);
            }}
          />
        )}
      </div>
      <UnscheduledSection
        issues={unscheduled}
        readOnly={readOnly}
        onSchedule={(issueNumber) =>
          updateIssue.mutate({
            number: issueNumber,
            data: defaultScheduleRange(new Date()),
          })
        }
      />
    </>
  );
}
