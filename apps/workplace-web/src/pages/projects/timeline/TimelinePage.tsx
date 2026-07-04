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
import {
  useMilestones,
  useUpdateMilestone,
} from '../../../hooks/queries/useMilestones';
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
  milestonesToMarkers,
  splitSchedulable,
} from './timelineData';
import { TimelineFilterBar } from './TimelineFilterBar';
import { TimelineGantt, type TimelineZoom } from './TimelineGantt';
import { UnscheduledSection } from './UnscheduledSection';

export default function TimelinePage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filters = parseFilters(params);
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
  const search = useIssueSearch(key, filters, 100);
  const cycles = useCycles(key);
  const milestones = useMilestones(key);
  const dependencies = useProjectDependencies(key);

  // 이슈 전량이 필요한 화면이라 hasNextPage 동안 자동으로 다음 페이지를 페치한다.
  useEffect(() => {
    if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
  }, [search.hasNextPage, search.isFetchingNextPage, search]);

  const issues = useMemo(() => (search.data?.pages ?? []).flatMap((p) => p.items), [search.data]);
  const { bars, unscheduled } = useMemo(() => splitSchedulable(issues), [issues]);
  const cycleBands = useMemo(() => cyclesToBands(cycles.data ?? []), [cycles.data]);
  const milestoneMarkers = useMemo(
    () => milestonesToMarkers(milestones.data ?? []),
    [milestones.data],
  );
  // 일정 미정/CANCELED 이슈로의 화살표는 SVAR 가 렌더할 노드가 없어 제외한다.
  const renderableDependencies = useMemo(
    () => filterRenderableDependencies(dependencies.data ?? [], bars),
    [dependencies.data, bars],
  );

  const readOnly = !(project.data?.viewerIsMember ?? false);
  const updateIssue = useTimelineIssueUpdate(key);
  const updateMilestone = useUpdateMilestone(key);

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
          bars={bars}
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
          onMilestoneMove={(id, dueDate) => {
            if (readOnly) return;
            const target = milestones.data?.find((m) => m.id === id);
            if (!target) return;
            // 이름/설명은 기존 값을 유지하고 dueDate 만 교체 — PATCH 는 MilestoneRequest 전체를 요구한다.
            updateMilestone.mutate({
              id,
              body: {
                name: target.name,
                dueDate,
                description: target.description ?? undefined,
              },
            });
          }}
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
