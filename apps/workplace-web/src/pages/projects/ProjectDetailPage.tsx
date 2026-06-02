import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { useProject } from '../../hooks/queries/useProjects';
import { parseFilters, parseGroupBy, parseView } from '../../lib/issueFilters';
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

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">{project.data?.name}</h1>
          <p className="text-muted-foreground">{project.data?.key}</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/projects/${key}/settings`}>
            <Button variant="outline">설정</Button>
          </Link>
          <Button onClick={() => setOpen(true)}>+ 새 태스크</Button>
        </div>
      </div>
      <IssueArea projectKey={key} />
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
