import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

import { useProject } from '../../hooks/queries/useProjects';
import { useEpicPanelOpen } from '../../hooks/useEpicPanelOpen';
import { parseFilters, parseGroupBy, parseView } from '../../lib/issueFilters';
import { EpicSidePanel } from './components/EpicSidePanel';
import { IssueBoardView } from './components/IssueBoardView';
import { IssueCreateDialog } from './components/IssueCreateDialog';
import { IssueFilterBar } from './components/IssueFilterBar';
import { IssueListView } from './components/IssueListView';
import { ViewChipBar } from './components/ViewChipBar';
import { PersonalProjectDetail } from './personal/PersonalProjectDetail';

// 프로젝트 홈 — 태스크 필터/뷰 영역 + 새 태스크 생성. URL: /projects/:key
// view / 필터는 URL SearchParams 가 단일 source of truth.
export default function ProjectDetailPage() {
  const { key = '' } = useParams();
  const [open, setOpen] = useState(false);
  const project = useProject(key);

  if (project.isLoading)
    return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error)
    return (
      <p className="w-full p-6 text-destructive">
        프로젝트를 불러올 수 없습니다
      </p>
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
        contained
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
      <div className="flex-1 overflow-y-auto">
        <div className="w-full p-6 space-y-4">
          <IssueArea
            projectKey={key}
            onOpenCreate={canCreateIssue ? () => setOpen(true) : undefined}
            canDragStatus={canDragStatus}
          />
        </div>
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
  const filters = parseFilters(params);
  const view = parseView(params);
  const groupBy = parseGroupBy(params);
  // 에픽 패널 열림 상태 — ViewChipBar(토글 버튼)와 EpicSidePanel(조건 마운트)이 공유.
  const { open: epicPanelOpen, toggle: toggleEpicPanel } = useEpicPanelOpen(projectKey);

  return (
    <section aria-label="태스크" className="flex items-stretch gap-4">
      {epicPanelOpen && <EpicSidePanel projectKey={projectKey} canCreateIssue={onOpenCreate != null} />}
      <div className="min-w-0 flex-1">
        <ViewChipBar
          projectKey={projectKey}
          epicPanelOpen={epicPanelOpen}
          onToggleEpicPanel={toggleEpicPanel}
        />
        <IssueFilterBar projectKey={projectKey} />
        {view === 'board' ? (
          <IssueBoardView
            projectKey={projectKey}
            filters={filters}
            groupBy={groupBy}
            onOpenCreate={onOpenCreate}
            canDragStatus={canDragStatus}
          />
        ) : (
          <IssueListView projectKey={projectKey} filters={filters} groupBy={groupBy} onOpenCreate={onOpenCreate} />
        )}
      </div>
    </section>
  );
}
