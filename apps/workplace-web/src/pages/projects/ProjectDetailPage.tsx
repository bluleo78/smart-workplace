import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

import { useProject } from '../../hooks/queries/useProjects';
import { parseFilters, parseGroupBy, parseView } from '../../lib/issueFilters';
import { PersonalProjectDetail } from './personal/PersonalProjectDetail';
import { IssueBoardView } from './components/IssueBoardView';
import { IssueCreateDialog } from './components/IssueCreateDialog';
import { IssueFilterBar } from './components/IssueFilterBar';
import { IssueListView } from './components/IssueListView';
import { ViewChipBar } from './components/ViewChipBar';

// 프로젝트 홈 — 태스크 필터/뷰 영역 + 새 태스크 생성. URL: /projects/:key
// view / 필터는 URL SearchParams 가 단일 source of truth.
export default function ProjectDetailPage() {
  const { key = '' } = useParams();
  const [open, setOpen] = useState(false);
  const project = useProject(key);

  if (project.isLoading)
    return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error)
    return (
      <p className="container mx-auto p-6 text-destructive">
        프로젝트를 불러올 수 없습니다
      </p>
    );

  // 개인 프로젝트는 전용 화면으로 분기 — 팀 화면(사이클/설정/필터바)을 렌더하지 않는다.
  if (project.data?.type === 'PERSONAL') {
    return <PersonalProjectDetail project={project.data} />;
  }

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
            <Link to={`/projects/${key}/settings`}>
              <Button variant="outline">설정</Button>
            </Link>
            <Button onClick={() => setOpen(true)}>+ 새 태스크</Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-6 space-y-4">
          <IssueArea projectKey={key} />
        </div>
      </div>
      <IssueCreateDialog projectKey={key} open={open} onOpenChange={setOpen} />
    </div>
  );
}

// IssueFilterBar 와 활성 뷰(list/board) 를 묶는 영역.
// FilterBar 가 URL 을 갱신하면 useSearchParams 의 재렌더로 자식 뷰가 같이 갱신된다.
function IssueArea({ projectKey }: { projectKey: string }) {
  const [params] = useSearchParams();
  const filters = parseFilters(params);
  const view = parseView(params);
  const groupBy = parseGroupBy(params);

  return (
    <section aria-label="태스크">
      <ViewChipBar projectKey={projectKey} />
      <IssueFilterBar projectKey={projectKey} />
      {view === 'board' ? (
        <IssueBoardView projectKey={projectKey} filters={filters} groupBy={groupBy} />
      ) : (
        <IssueListView projectKey={projectKey} filters={filters} groupBy={groupBy} />
      )}
    </section>
  );
}
