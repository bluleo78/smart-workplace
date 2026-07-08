// 프로젝트 타임라인(간트) — 진입·툴바(줌/오늘)·필터·읽기·드래그 편집(Task 8)·마일스톤 UX(Task 9)·
// 의존 화살표(표시 전용)+일정 미정 섹션(Task 10) 렌더. URL: /projects/:key/timeline
import { format } from 'date-fns';
import { ArrowLeft, Diamond } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

import { useCycles } from '../../../hooks/queries/useCycles';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useMilestones } from '../../../hooks/queries/useMilestones';
import { useProjectDependencies } from '../../../hooks/queries/useProjectDependencies';
import { useProject } from '../../../hooks/queries/useProjects';
import { useTimelineIssueUpdate } from '../../../hooks/queries/useTimelineIssueUpdate';
import { parseFilters } from '../../../lib/issueFilters';
import type { MilestoneResponse } from '../../../types/milestone';
import { MilestoneEditPopover } from './MilestoneEditPopover';
import { MilestoneFormDialog } from './MilestoneFormDialog';
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

export default function TimelinePage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filters = parseFilters(params);
  // 에픽 트리(collapse/expand)를 위해 목록 뷰(IssueListView)와 동일한 기본값을 주입한다 — topLevel 을
  // 끄지 않으면 에픽의 하위 이슈(비-top-level)가 응답에서 빠져 에픽이 자식 없는 잎 행으로만 그려지고
  // 펼침 토글이 사라진다. 하위는 노출하되 SUBTASK 는 계획 단위가 아니므로 제외한다. URL 에 topLevel 이
  // 명시된 경우엔 사용자의 선택을 존중해 주입하지 않는다(명시값 우선).
  const effectiveFilters =
    params.get('topLevel') == null ? { ...filters, topLevel: false, excludeSubtasks: true } : filters;
  const [zoom, setZoom] = useState<TimelineZoom>('week');
  const [scrollToDate, setScrollToDate] = useState<string | undefined>(undefined);
  // 마일스톤 생성 다이얼로그(툴바 버튼/레인 클릭 2경로 공용) + 편집 팝오버(다이아몬드 클릭) 상태.
  const [milestoneDialogState, setMilestoneDialogState] = useState<{ defaultDueDate?: string } | null>(
    null,
  );
  const [milestoneEditState, setMilestoneEditState] = useState<{
    milestone: MilestoneResponse;
    anchorRect: DOMRect;
  } | null>(null);

  const project = useProject(key);
  const search = useIssueSearch(key, effectiveFilters, 100);
  const cycles = useCycles(key);
  const milestones = useMilestones(key);
  const dependencies = useProjectDependencies(key);

  // 이슈 전량이 필요한 화면이라 hasNextPage 동안 자동으로 다음 페이지를 페치한다.
  useEffect(() => {
    if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
  }, [search.hasNextPage, search.isFetchingNextPage, search]);

  const issues = useMemo(() => (search.data?.pages ?? []).flatMap((p) => p.items), [search.data]);
  // 에픽 계층 트리(#649) — bars 평면 목록 대신 에픽 그룹 트리로 변환.
  const { groups, unscheduled } = useMemo(() => groupTimelineIssues(issues), [issues]);
  const cycleBands = useMemo(() => cyclesToBands(cycles.data ?? []), [cycles.data]);
  const milestoneMarkers = useMemo(
    () => milestonesToMarkers(milestones.data ?? []),
    [milestones.data],
  );
  // 일정 미정/CANCELED 이슈로의 화살표는 SVAR 가 렌더할 노드가 없어 제외한다.
  const renderableDependencies = useMemo(
    () => filterRenderableDependencies(dependencies.data ?? [], groups.flatMap((g) => g.bars)),
    [dependencies.data, groups],
  );

  // 에픽 그룹 접힘 상태 — localStorage 로 프로젝트별 지속(#649). 페이지가 소유하고
  // TimelineGantt 는 collapsedKeys/onToggleGroup props 로만 상태를 주고받는다.
  const collapseStorageKey = `timeline-collapsed:${key}`;
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(collapseStorageKey) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const handleToggleGroup = (groupKey: string, open: boolean) => {
    setCollapsedKeys((prev) => {
      const next = open ? prev.filter((k) => k !== groupKey) : [...new Set([...prev, groupKey])];
      localStorage.setItem(collapseStorageKey, JSON.stringify(next));
      return next;
    });
  };

  const readOnly = !(project.data?.viewerIsMember ?? false);
  const updateIssue = useTimelineIssueUpdate(key);

  // 마일스톤별 연결된 이슈 수 — 이슈 목록에서 파생(팝오버 "연결된 이슈 N개" 표시용).
  const linkedIssueCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const issue of issues) {
      if (issue.milestoneId == null) continue;
      counts.set(issue.milestoneId, (counts.get(issue.milestoneId) ?? 0) + 1);
    }
    return counts;
  }, [issues]);

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="timeline-page">
      <PageHeader
        contained
        icon={
          <Button
            variant="ghost"
            size="icon"
            aria-label="프로젝트로 돌아가기"
            onClick={() => navigate(`/projects/${key}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title="타임라인"
        meta={<span className="text-muted-foreground">{project.data?.key}</span>}
        actions={
          <div className="flex items-center gap-1" role="group" aria-label="줌 전환">
            <Button
              variant="outline"
              size="sm"
              aria-pressed={zoom === 'week'}
              className={zoom === 'week' ? 'bg-accent' : undefined}
              onClick={() => setZoom('week')}
            >
              주
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={zoom === 'month'}
              className={zoom === 'month' ? 'bg-accent' : undefined}
              onClick={() => setZoom('month')}
            >
              월
            </Button>
            <Button
              variant="outline"
              size="sm"
              // toISOString()은 UTC라 KST 0~9시에 어제로 스크롤 — 로컬 날짜 기준으로 계산.
              onClick={() => setScrollToDate(format(new Date(), 'yyyy-MM-dd'))}
            >
              오늘
            </Button>
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                data-testid="milestone-add-button"
                onClick={() => setMilestoneDialogState({})}
              >
                <Diamond className="mr-1 h-3 w-3" />
                마일스톤 추가
              </Button>
            )}
          </div>
        }
      />
      <div className="border-b px-6 py-1">
        <TimelineFilterBar projectKey={key} />
      </div>
      <div className="min-h-0 flex-1 p-6" data-testid="timeline-gantt">
        <TimelineGantt
          groups={groups}
          collapsedKeys={collapsedKeys}
          onToggleGroup={handleToggleGroup}
          milestones={milestoneMarkers}
          cycles={cycleBands}
          dependencies={renderableDependencies}
          zoom={zoom}
          readOnly={readOnly}
          scrollToDate={scrollToDate}
          onBarChange={(issueNumber, change) =>
            updateIssue.mutate({
              number: issueNumber,
              data: { startDate: change.startDate, dueDate: change.dueDate },
            })
          }
          onBarClick={(issueNumber) => navigate(`/projects/${key}/issues/${issueNumber}`)}
          onMilestoneClick={(id, anchorRect) => {
            const target = milestones.data?.find((m) => m.id === id);
            if (target) setMilestoneEditState({ milestone: target, anchorRect });
          }}
          onLaneClick={(date) => {
            if (readOnly) return;
            setMilestoneDialogState({ defaultDueDate: date });
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
      <MilestoneFormDialog
        projectKey={key}
        defaultDueDate={milestoneDialogState?.defaultDueDate}
        open={milestoneDialogState !== null}
        onOpenChange={(open) => {
          if (!open) setMilestoneDialogState(null);
        }}
      />
      {milestoneEditState && (
        <MilestoneEditPopover
          projectKey={key}
          milestone={milestoneEditState.milestone}
          linkedCount={linkedIssueCounts.get(milestoneEditState.milestone.id) ?? 0}
          anchorRect={milestoneEditState.anchorRect}
          onClose={() => setMilestoneEditState(null)}
        />
      )}
    </div>
  );
}
