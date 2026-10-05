// 데스크톱 타임라인 본문 — 필터바·간트·일정 미정 섹션. TimelinePage 에서 분리해 데스크톱(≥1024px)에서만 마운트한다.
// 왜: 의존성 조회·사이클 조회·에픽 그룹/화살표 계산은 간트 전용이라, 모바일 아젠다(WP-197)에선 돌 필요가 없다.
// 이슈 전량·마일스톤·자동 다음 페이지 페치·마일스톤 다이얼로그/팝오버 상태는 모바일과 공유하므로 TimelinePage 가 소유한다.
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCycles } from '../../../hooks/queries/useCycles';
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
}) {
  const navigate = useNavigate();
  const cycles = useCycles(key);
  const dependencies = useProjectDependencies(key);
  const updateIssue = useTimelineIssueUpdate(key);

  // 에픽 계층 트리(#649) — bars 평면 목록 대신 에픽 그룹 트리로 변환.
  const { groups, unscheduled } = useMemo(() => groupTimelineIssues(issues), [issues]);
  const cycleBands = useMemo(() => cyclesToBands(cycles.data ?? []), [cycles.data]);
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
      <div className="border-b px-4 py-1">
        <TimelineFilterBar projectKey={key} />
      </div>
      <div className="min-h-0 flex-1 px-4 py-6" data-testid="timeline-gantt">
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
