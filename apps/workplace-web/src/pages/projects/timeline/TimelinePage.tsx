// 프로젝트 타임라인(간트) — 진입·툴바(줌/오늘)·필터·읽기·드래그 편집(Task 8)·마일스톤 UX(Task 9)·
// 의존 화살표(표시 전용)+일정 미정 섹션(Task 10) 렌더. URL: /projects/:key/timeline
import { format } from 'date-fns';
import { ArrowLeft, Diamond } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useMilestones } from '../../../hooks/queries/useMilestones';
import { useProject } from '../../../hooks/queries/useProjects';
import { parseFilters } from '../../../lib/issueFilters';
import type { MilestoneResponse } from '../../../types/milestone';
import { MilestoneEditPopover } from './MilestoneEditPopover';
import { MilestoneFormDialog } from './MilestoneFormDialog';
import { TimelineAgendaList } from './TimelineAgendaList';
import { TimelinePeriodChip } from './TimelinePeriodChip';
import { resolvePeriod } from './timelineData';
import type { TimelineZoom } from './TimelineGantt';
import { TimelineGanttBody } from './TimelineGanttBody';
import { TimelinePeriodPicker } from './TimelinePeriodPicker';
import type { PeriodParam, TimelineViewOptions } from './timelineTypes';
import { useTimelinePeriod } from './useTimelinePeriod';

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
  const milestones = useMilestones(key);
  // 조회 기간(WP-247) — 화면 거름은 상태 필터의 「취소」 포함 여부와 함께 간트·아젠다에 넘긴다(조회 자체는 전량 그대로).
  const periodCtl = useTimelinePeriod(key);

  // 이슈 전량이 필요한 화면이라 hasNextPage 동안 자동으로 다음 페이지를 페치한다.
  useEffect(() => {
    if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
  }, [search.hasNextPage, search.isFetchingNextPage, search]);

  const issues = useMemo(() => (search.data?.pages ?? []).flatMap((p) => p.items), [search.data]);
  // 모바일 = 아젠다(WP-197), 데스크톱 = 간트 본문(TimelineGanttBody) — 간트 전용 조회·계산은 그 본문 안에서만 돈다.
  const isMobile = useIsMobile();
  const readOnly = !(project.data?.viewerIsMember ?? false);
  // filters 는 렌더마다 새로 파싱되므로 boolean 으로 줄여 메모 키로 쓴다.
  const includeCanceled = filters.statuses.includes('CANCELED');
  const view = useMemo<TimelineViewOptions>(
    () => ({ includeCanceled, period: periodCtl.period }),
    [includeCanceled, periodCtl.period],
  );

  // 기간을 바꾸면 간트를 새 기간 시작일로 옮긴다 — 새 기간이 화면 밖일 수 있어서. 전체(null)면 그대로.
  const changePeriod = (p: PeriodParam) => {
    periodCtl.setParam(p);
    const next = resolvePeriod(p, periodCtl.cycles, new Date());
    if (next) setScrollToDate(next.from);
  };
  const periodPicker = (
    <TimelinePeriodPicker param={periodCtl.param} period={periodCtl.period} cycles={periodCtl.cycles} onChange={changePeriod} />
  );

  // 마일스톤별 연결된 이슈 수 — 팝오버가 열린 마일스톤만 이슈 목록에서 센다("연결된 이슈 N개" 표시용).
  const editingMilestoneId = milestoneEditState?.milestone.id;
  const linkedIssueCount = useMemo(
    () => (editingMilestoneId == null ? 0 : issues.filter((i) => i.milestoneId === editingMilestoneId).length),
    [issues, editingMilestoneId],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="timeline-page">
      <PageHeader
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
        // 모바일: 줌·「오늘」은 아젠다에 의미가 없어 숨기고, 멤버만 「마일스톤 추가」(항목 1개라 헤더에 인라인 — U3-R7).
        mobileActions={
          readOnly ? null : (
            <Button variant="ghost" size="sm" data-testid="milestone-add-button" onClick={() => setMilestoneDialogState({})}>
              <Diamond aria-hidden />
              마일스톤 추가
            </Button>
          )
        }
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
      {!periodCtl.ready ? (
        <div data-testid="timeline-period-loading" className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          불러오는 중…
        </div>
      ) : isMobile ? (
        <TimelineAgendaList
          projectKey={key}
          issues={issues}
          milestones={milestones.data ?? []}
          loading={search.isLoading || search.isFetchingNextPage || search.hasNextPage === true}
          onOpenIssue={(n) => navigate(`/projects/${key}/issues/${n}`)}
          view={view}
          periodChip={<TimelinePeriodChip param={periodCtl.param} period={periodCtl.period} cycles={periodCtl.cycles} onChange={changePeriod} />}
        />
      ) : (
        <TimelineGanttBody
          projectKey={key}
          issues={issues}
          milestones={milestones.data}
          zoom={zoom}
          readOnly={readOnly}
          scrollToDate={scrollToDate}
          onMilestoneClick={(milestone, anchorRect) => setMilestoneEditState({ milestone, anchorRect })}
          onLaneClick={(date) => setMilestoneDialogState({ defaultDueDate: date })}
          view={view}
          periodPicker={periodPicker}
          loading={search.isLoading || search.isFetchingNextPage || search.hasNextPage === true}
        />
      )}
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
          linkedCount={linkedIssueCount}
          anchorRect={milestoneEditState.anchorRect}
          onClose={() => setMilestoneEditState(null)}
        />
      )}
    </div>
  );
}
