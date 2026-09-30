import { FolderX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { ResourceErrorState } from '@/components/layout/ResourceErrorState';
import { Button } from '@/components/ui/button';

import { useCycles } from '../../hooks/queries/useCycles';
import { useIssueTypes } from '../../hooks/queries/useIssueTypes';
import { useLabels } from '../../hooks/queries/useLabels';
import { useMilestones } from '../../hooks/queries/useMilestones';
import { useProjectMembers } from '../../hooks/queries/useProjectMembers';
import { useProject } from '../../hooks/queries/useProjects';
import { useEpicPanelOpen } from '../../hooks/useEpicPanelOpen';
import { useIssueGroupBy } from '../../hooks/useIssueGroupBy';
import { buildIssueListContext } from '../../lib/aiScreenContext/builders/issue';
import { parseFilters, parseView, toClientGroupBy, withDefaultIssueScope } from '../../lib/issueFilters';
import { EpicSidePanel } from './components/EpicSidePanel';
import { IssueBoardView } from './components/IssueBoardView';
import { IssueCreateDialog } from './components/IssueCreateDialog';
import { IssueCycleGroupedList, IssueCycleListSkeleton } from './components/IssueCycleGroupedList';
import { IssueFilterBar } from './components/IssueFilterBar';
import { IssueListView } from './components/IssueListView';
import { ViewChipBar } from './components/ViewChipBar';
import { PersonalProjectDetail } from './personal/PersonalProjectDetail';

// 프로젝트 홈 — 태스크 필터/뷰 영역 + 새 태스크 생성. URL: /projects/:key
// view / 필터는 URL SearchParams 가 단일 source of truth.
export default function ProjectDetailPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const project = useProject(key);

  if (project.isLoading)
    return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error)
    return (
      <ResourceErrorState
        icon={FolderX}
        title="프로젝트를 불러올 수 없습니다"
        description="요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다."
        actionLabel="프로젝트 목록으로"
        onAction={() => navigate('/projects')}
      />
    );

  // 개인 프로젝트는 전용 화면으로 분기 — 팀 화면(사이클/설정/필터바)을 렌더하지 않는다.
  if (project.data?.type === 'PERSONAL') {
    return <PersonalProjectDetail project={project.data} />;
  }

  // OPEN 프로젝트: 테넌트 전원 이슈 생성 허용. TEAM 은 멤버만.
  // viewerIsMember 는 서버 플래그 — 클라이언트에서 재파생하지 않는다.
  const isOpenProject = project.data?.type === 'OPEN';
  const canCreateIssue = isOpenProject || (project.data?.viewerIsMember ?? false);
  const canDragStatus = project.data?.viewerIsMember ?? false;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={project.data?.name ?? ''}
        meta={<span className="text-muted-foreground">{project.data?.key}</span>}
        actions={
          <>
            <Link to={`/projects/${key}/cycles`}>
              <Button variant="outline">사이클</Button>
            </Link>
            <Link to={`/projects/${key}/timeline`}>
              <Button variant="outline">타임라인</Button>
            </Link>
            <Link to={`/projects/${key}/settings`}>
              <Button variant="outline">설정</Button>
            </Link>
            {canCreateIssue && (
              <Button onClick={() => setOpen(true)}>+ 새 태스크</Button>
            )}
          </>
        }
      />
      {/* 본문 래퍼는 스크롤하지 않고 남은 높이만 고정한다. 스크롤은 IssueArea 안에서
          에픽 패널(자체 목록 스크롤)과 우측 목록/보드 영역이 각자 독립적으로 담당한다.
          (래퍼가 스크롤하면 패널과 목록이 한 덩어리로 같이 스크롤된다.) */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-6">
        <IssueArea
          projectKey={key}
          onOpenCreate={canCreateIssue ? () => setOpen(true) : undefined}
          canDragStatus={canDragStatus}
        />
      </div>
      <IssueCreateDialog projectKey={key} open={open} onOpenChange={setOpen} />
    </div>
  );
}

// IssueFilterBar 와 활성 뷰(list/board) 를 묶는 영역.
// FilterBar 가 URL 을 갱신하면 useSearchParams 의 재렌더로 자식 뷰가 같이 갱신된다.
function IssueArea({
  projectKey,
  onOpenCreate,
  canDragStatus = true,
}: {
  projectKey: string;
  onOpenCreate?: () => void;
  canDragStatus?: boolean;
}) {
  const [params] = useSearchParams();
  // params 가 바뀔 때만 새 필터 객체 — 매 렌더 새 객체면 아래 화면 컨텍스트 useMemo 가 매번 재계산된다.
  const filters = useMemo(() => parseFilters(params), [params]);
  const view = parseView(params);
  // 그룹 기준 — URL 에 없으면 진행 중·예정 사이클이 있을 때 사이클 그룹이 목록 기본값(#878).
  // pending(사이클 목록 로딩 중)엔 스켈레톤 — 평면 목록이 잠깐 떴다 구간 목록으로 바뀌는 깜빡임과 헛요청을 막는다.
  const { groupBy, pending: groupPending } = useIssueGroupBy(projectKey, true);
  // 에픽 패널 열림 상태 — ViewChipBar(토글 버튼)와 EpicSidePanel(조건 마운트)이 공유.
  const { open: epicPanelOpen, toggle: toggleEpicPanel } = useEpicPanelOpen(projectKey);

  // WP-54: 필터 id → 이름 해석용 목록(IssueFilterBar 와 같은 쿼리 키 → 캐시 공유) + 프로젝트 이름.
  const project = useProject(projectKey);
  const members = useProjectMembers(projectKey);
  const labels = useLabels(projectKey);
  const types = useIssueTypes(projectKey);
  const cycles = useCycles(projectKey);
  const milestones = useMilestones(projectKey);
  // 리스트 뷰가 보고하는 로드 건수 — 보드는 컬럼별 로드, 사이클 그룹(#878)은 구간별 로드라 건수를 싣지 않는다.
  const [loaded, setLoaded] = useState<{ count: number; hasMore: boolean } | null>(null);
  // 목록 정체성(보기 + 리스트 쿼리 키와 같은 기본 범위 적용 필터)이 바뀌면 이전 건수를 버린다 —
  // 필터 변경 직후 전송 시 새 필터와 옛 건수가 짝지어지지 않게. 렌더 중 조정이라 한 프레임도 옛 건수가 남지 않는다.
  const listIdentity = `${view}:${JSON.stringify(withDefaultIssueScope(filters))}`;
  const [prevListIdentity, setPrevListIdentity] = useState(listIdentity);
  if (prevListIdentity !== listIdentity) {
    setPrevListIdentity(listIdentity);
    setLoaded(null);
  }
  // 값이 같으면 이전 상태를 그대로 돌려 리렌더·컨텍스트 재계산을 건너뛴다(리스트가 data 변경마다 보고하므로).
  const onLoadedChange = useCallback(
    (count: number, hasMore: boolean) =>
      setLoaded((prev) => (prev && prev.count === count && prev.hasMore === hasMore ? prev : { count, hasMore })),
    [],
  );
  const listLoaded = view === 'board' || groupBy === 'cycle' ? null : loaded;
  const screenContext = useMemo(
    () =>
      buildIssueListContext({
        projectKey,
        projectName: project.data?.name ?? projectKey,
        view,
        groupBy,
        filters,
        lookups: {
          members: members.data ?? [],
          labels: labels.data ?? [],
          types: types.data ?? [],
          cycles: cycles.data ?? [],
          milestones: milestones.data ?? [],
        },
        count: listLoaded?.count,
        hasMore: listLoaded?.hasMore,
      }),
    [projectKey, project.data?.name, view, groupBy, filters, members.data, labels.data, types.data, cycles.data, milestones.data, listLoaded],
  );
  useRegisterAiScreenContext(screenContext);

  return (
    <section aria-label="태스크" className="flex min-h-0 flex-1 items-stretch gap-4">
      {epicPanelOpen && <EpicSidePanel projectKey={projectKey} canCreateIssue={onOpenCreate != null} />}
      {/* 우측 영역: 뷰 칩바·필터바는 고정, 아래 콘텐츠 슬롯에서 목록/보드가 스스로 스크롤한다
          (목록=테이블 영역, 보드=컬럼 행 — 각자 가로·세로 스크롤 + 헤더 sticky). 에픽 패널은 따로 고정. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0">
          <ViewChipBar
            projectKey={projectKey}
            epicPanelOpen={epicPanelOpen}
            onToggleEpicPanel={toggleEpicPanel}
          />
          <IssueFilterBar projectKey={projectKey} />
        </div>
        {/* overflow-auto: 목록/보드는 h-full 로 슬롯을 정확히 채워 자체 스크롤하고,
            로딩·빈 상태·사이클 구간 목록처럼 자체 스크롤이 없는 화면이 넘칠 때만 이 슬롯이 스크롤한다. */}
        <div className="min-h-0 flex-1 overflow-auto">
          {view === 'board' ? (
            <IssueBoardView
              projectKey={projectKey}
              // 팀 보드 기본 범위 — 에픽 카드 제외, 에픽 하위 이슈 노출, SUBTASK 숨김(목록과 동일 규칙).
              filters={withDefaultIssueScope(filters)}
              groupBy={toClientGroupBy(groupBy)}
              onOpenCreate={onOpenCreate}
              canDragStatus={canDragStatus}
            />
          ) : groupPending ? (
            <IssueCycleListSkeleton />
          ) : groupBy === 'cycle' ? (
            <IssueCycleGroupedList projectKey={projectKey} filters={filters} />
          ) : (
            <IssueListView
              projectKey={projectKey}
              filters={filters}
              groupBy={toClientGroupBy(groupBy)}
              onOpenCreate={onOpenCreate}
              onLoadedChange={onLoadedChange}
            />
          )}
        </div>
      </div>
    </section>
  );
}
