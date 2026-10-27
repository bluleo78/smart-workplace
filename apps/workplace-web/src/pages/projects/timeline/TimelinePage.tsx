// 프로젝트 타임라인(간트) — 진입·툴바(줌/오늘)·필터·읽기·드래그 편집(Task 8)·마일스톤 UX(Task 9)·
// 의존 화살표(표시 전용)+일정 미정 섹션(Task 10) 렌더. URL: /projects/:key/timeline
import { format } from 'date-fns';
import { ArrowLeft, Diamond } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Page, pageGutterClass } from '@/components/layout/Page';
import { RemainingPagesError } from '@/components/RemainingPagesError';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/useIsMobile';
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';

import { remainingPagesFailed, useFetchAllPages } from '../../../hooks/queries/useFetchAllPages';
import { useIssueSearch } from '../../../hooks/queries/useIssueSearch';
import { useMilestones } from '../../../hooks/queries/useMilestones';
import { useProject } from '../../../hooks/queries/useProjects';
import { useProjectStatusList } from '../../../hooks/queries/useProjectStatuses';
import { useVersions } from '../../../hooks/queries/useVersions';
import { useCanManageProject } from '../../../hooks/useCanManageProject';
import { parseFilters } from '../../../lib/issueFilters';
import type { IssueFilters } from '../../../types/issue';
import type { MilestoneResponse } from '../../../types/milestone';
import { ProjectStatusesGate } from '../components/ProjectStatusesGate';
import { ProjectUnavailableState } from '../components/ProjectUnavailableState';
import { MilestoneEditPopover } from './MilestoneEditPopover';
import { MilestoneFormDialog } from './MilestoneFormDialog';
import { TimelineAgendaList } from './TimelineAgendaList';
import { initialScrollDate, resolvePeriod, versionsToMarkers } from './timelineData';
import type { TimelineScrollRequest } from './TimelineGantt';
import { TimelineGanttBody } from './TimelineGanttBody';
import { TimelinePeriodChip } from './TimelinePeriodChip';
import { TimelinePeriodPicker } from './TimelinePeriodPicker';
import type { PeriodParam, TimelineViewOptions } from './timelineTypes';
import { useTimelinePeriod } from './useTimelinePeriod';
import { useTimelineZoom } from './useTimelineZoom';

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
  // 보기 단위(일·주·월) — 사용자별로 기억한다(WP-889).
  const [zoom, setZoom] = useTimelineZoom();
  // 간트 스크롤 요청 — 요청마다 seq 를 올린 새 객체라 같은 날짜(첫 진입 날짜 = 「오늘」 등)도 다시 스크롤한다(WP-938).
  const [scrollRequest, setScrollRequest] = useState<TimelineScrollRequest | undefined>(undefined);
  const scrollTo = (date: string) => setScrollRequest((prev) => ({ date, seq: (prev?.seq ?? 0) + 1 }));
  // 마일스톤 생성 다이얼로그(툴바 버튼/레인 클릭 2경로 공용) + 편집 팝오버(다이아몬드 클릭) 상태.
  const [milestoneDialogState, setMilestoneDialogState] = useState<{ defaultDueDate?: string } | null>(
    null,
  );
  const [milestoneEditState, setMilestoneEditState] = useState<{
    milestone: MilestoneResponse;
    anchorRect: DOMRect;
  } | null>(null);

  const project = useProject(key);
  // 탭 제목 — 「타임라인 · {프로젝트}」(WP-814).
  useDocumentTitle(['타임라인', project.data?.name]);
  const search = useIssueSearch(key, effectiveFilters, 100);
  const milestones = useMilestones(key);
  // 버전 출시일(WP-888) — 출시일 있는 미출시·출시됨만 「버전」 레인/모바일 칩으로. 개인 프로젝트는 버전이 없어 요청하지 않는다.
  const versions = useVersions(key, { enabled: !!project.data && project.data.type !== 'PERSONAL' });
  const versionMarkers = useMemo(() => versionsToMarkers(versions.data ?? []), [versions.data]);
  // 조회 기간(WP-247) — 화면 거름은 상태 필터의 「취소」 포함 여부와 함께 간트·아젠다에 넘긴다(조회 자체는 전량 그대로).
  const periodCtl = useTimelinePeriod(key);

  // 이슈 전량이 필요한 화면이라 남은 페이지를 끝까지 차례로 받는다(WP-996 — 빠른 응답에도 멈추지 않는다).
  useFetchAllPages(search);
  // 다음 페이지가 실패하면 자동 로드가 멈춰 받은 이슈만 그려진다 — 본문 위에 안내·다시 시도를 둔다(WP-1007).
  const nextPageFailed = remainingPagesFailed(search);

  const issues = useMemo(() => (search.data?.pages ?? []).flatMap((p) => p.items), [search.data]);
  // 모바일 = 아젠다(WP-197), 데스크톱 = 간트 본문(TimelineGanttBody) — 간트 전용 조회·계산은 그 본문 안에서만 돈다.
  const isMobile = useIsMobile();
  const readOnly = !(project.data?.viewerIsMember ?? false);
  // 마일스톤 추가·수정·삭제는 버전·사이클처럼 프로젝트 OWNER(·ADMIN)만(WP-1008) — 이슈 막대 편집(멤버)과 따로 판정한다.
  const { canManage: canManageMilestones } = useCanManageProject(key);
  // 기간을 바꾸면 간트를 새 기간 시작일로 옮긴다 — 새 기간이 화면 밖일 수 있어서. 전체(null)면 그대로.
  const changePeriod = (p: PeriodParam) => {
    periodCtl.setParam(p);
    const next = resolvePeriod(p, periodCtl.cycles, new Date());
    if (next) scrollTo(next.from);
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

  // 첫 로드·자동 다음 페이지 페치 중 — 간트·아젠다 모두 이 동안 빈 상태를 띄우지 않는다.
  // 실패해 멈췄으면 더는 불러오는 중이 아니다 — 계속 로딩으로 두면 빈 상태 안내가 영영 가려진다.
  const issuesLoading = search.isLoading || search.isFetchingNextPage || (search.hasNextPage === true && !nextPageFailed);
  // 처음 열 때 한 번 오늘·조회 기간 쪽으로 스크롤한다(WP-486) — 간트는 가장 이른 막대부터 그려져 좁은 폭(1024)에선
  // 오늘선·사이클 구간이 화면 밖이었다. 기간(사이클)이 풀리고 이슈를 다 받은 뒤에만 정한다. 렌더 중 상태 조정(effect 아님).
  if (scrollRequest === undefined && periodCtl.ready && !issuesLoading) {
    scrollTo(initialScrollDate(periodCtl.period, new Date()));
  }

  // 프로젝트를 볼 수 없으면(403·404) 관리 화면 대신 접근 불가 안내(WP-480). 훅을 모두 부른 뒤에 분기한다.
  if (project.error) return <ProjectUnavailableState />;

  return (
    <Page data-testid="timeline-page">
      <Page.Header
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
        // 모바일: 줌·「오늘」은 아젠다에 의미가 없어 숨기고, OWNER 만 「마일스톤 추가」(항목 1개라 헤더에 인라인 — U3-R7).
        mobileActions={
          canManageMilestones && (
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
              aria-pressed={zoom === 'day'}
              className={zoom === 'day' ? TOGGLE_ON_CLASS : undefined}
              onClick={() => setZoom('day')}
            >
              일
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={zoom === 'week'}
              className={zoom === 'week' ? TOGGLE_ON_CLASS : undefined}
              onClick={() => setZoom('week')}
            >
              주
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-pressed={zoom === 'month'}
              className={zoom === 'month' ? TOGGLE_ON_CLASS : undefined}
              onClick={() => setZoom('month')}
            >
              월
            </Button>
            <Button
              variant="outline"
              size="sm"
              // toISOString()은 UTC라 KST 0~9시에 어제로 스크롤 — 로컬 날짜 기준으로 계산.
              onClick={() => scrollTo(format(new Date(), 'yyyy-MM-dd'))}
            >
              오늘
            </Button>
            {canManageMilestones && (
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
      {/* 본문은 자체 레이아웃(padded=false) — 간트는 필터 줄·간트·일정 미정 섹션이 각자 pageGutterClass 로 헤더 축에 맞춘다. */}
      <Page.Body padded={false} className="flex-col overflow-hidden" data-testid="timeline-body">
        {nextPageFailed && (
          <RemainingPagesError
            message="나머지 이슈를 불러오지 못했습니다. 일부 이슈만 보입니다."
            onRetry={() => void search.fetchNextPage()}
            className={cn('shrink-0 border-b py-2 pointer-coarse:text-sm', pageGutterClass)}
            data-testid="timeline-load-error"
          />
        )}
        {/* 간트·아젠다(필터 바·필터 시트 포함)는 상태 목록을 받은 뒤에만 그린다(WP-938) — 받기 전에 그리면 「상태」 facet 이 비고
            취소 범주 판단이 빈 목록으로 돌았다. 목록·보드(WP-870)와 같은 관문 — 받기 전엔 로딩, 실패면 다시 시도. 헤더는 관문 밖. */}
        <ProjectStatusesGate
          projectKey={key}
          description="타임라인을 그릴 수 없습니다. 잠시 후 다시 시도해 주세요."
          // 기간 로딩(timeline-period-loading)과 같은 자리·모양·문구 — 두 로딩이 이어질 때 문구 자리도 글자도 바뀌지 않게.
          loadingClassName="flex flex-1 items-center justify-center text-sm"
        >
          <TimelineViewScope projectKey={key} filters={filters} period={periodCtl.period}>
            {(view) => !periodCtl.ready ? (
              <div data-testid="timeline-period-loading" className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {/* 관문 로딩(목록·보드와 같은 「로딩 중…」)과 같은 문구(WP-938). */}
                로딩 중…
              </div>
            ) : isMobile ? (
              <TimelineAgendaList
                projectKey={key}
                issues={issues}
                milestones={milestones.data ?? []}
                versions={versionMarkers}
                onOpenVersion={(id) => navigate(`/projects/${key}/versions/${id}`)}
                loading={issuesLoading}
                // 다른 프로젝트 에픽 머리 행(WP-1039)은 그 프로젝트 에픽으로 간다.
                onOpenIssue={(n, projectKey) => navigate(`/projects/${projectKey ?? key}/issues/${n}`)}
                view={view}
                onShowAllPeriods={() => changePeriod({ kind: 'all' })}
                periodChip={<TimelinePeriodChip param={periodCtl.param} period={periodCtl.period} cycles={periodCtl.cycles} onChange={changePeriod} />}
              />
            ) : (
              <TimelineGanttBody
                projectKey={key}
                issues={issues}
                milestones={milestones.data}
                versions={versionMarkers}
                onVersionClick={(id) => navigate(`/projects/${key}/versions/${id}`)}
                zoom={zoom}
                readOnly={readOnly}
                canEditMilestones={canManageMilestones}
                scrollRequest={scrollRequest}
                onMilestoneClick={(milestone, anchorRect) => setMilestoneEditState({ milestone, anchorRect })}
                onLaneClick={(date) => setMilestoneDialogState({ defaultDueDate: date })}
                view={view}
                periodPicker={periodPicker}
                loading={issuesLoading}
                cycles={periodCtl.cycles}
                onShowAllPeriods={() => changePeriod({ kind: 'all' })}
              />
            )}
          </TimelineViewScope>
        </ProjectStatusesGate>
      </Page.Body>
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
    </Page>
  );
}

/**
 * 간트·아젠다의 화면 거름(view)을 정해 children 에 넘긴다 — 상태 목록 관문 안에서만 그려, 상태 목록을 읽는 코드가 관문 밖에 없게 한다(WP-938).
 * 「상태」 필터로 취소 범주의 상태를 골라도 취소 이슈를 보여야 한다(WP-808) — 고른 상태 id 를 범주로 풀어 함께 본다.
 * filters 는 렌더마다 새로 파싱되므로 boolean 으로 줄여 메모 키로 쓴다.
 */
function TimelineViewScope({
  projectKey,
  filters,
  period,
  children,
}: {
  projectKey: string;
  filters: IssueFilters;
  period: TimelineViewOptions['period'];
  children: (view: TimelineViewOptions) => ReactNode;
}) {
  const projectStatuses = useProjectStatusList(projectKey);
  const includeCanceled =
    filters.statuses.includes('CANCELED') ||
    projectStatuses.some((s) => s.category === 'CANCELED' && filters.statusIds.includes(s.id));
  const view = useMemo<TimelineViewOptions>(() => ({ includeCanceled, period }), [includeCanceled, period]);
  return children(view);
}
