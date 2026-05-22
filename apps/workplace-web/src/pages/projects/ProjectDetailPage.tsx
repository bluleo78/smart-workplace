import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { useIssues } from '../../hooks/queries/useIssues';
import { useProject } from '../../hooks/queries/useProjects';
import { IssueCreateDialog } from './components/IssueCreateDialog';
import { IssueListTable } from './components/IssueListTable';

// 프로젝트 홈 — 이슈 리스트 + 새 이슈 생성. URL: /projects/:key
export default function ProjectDetailPage() {
  const { key = '' } = useParams();
  const [open, setOpen] = useState(false);
  const project = useProject(key);
  const issues = useIssues(key);

  if (project.isLoading) return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error) return <p className="container mx-auto p-6 text-destructive">프로젝트를 불러올 수 없습니다</p>;

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
          <Button onClick={() => setOpen(true)}>+ 새 이슈</Button>
        </div>
      </div>
      {issues.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : (
        <IssueListTable projectKey={key} issues={issues.data?.content ?? []} />
      )}
      <IssueCreateDialog projectKey={key} open={open} onOpenChange={setOpen} />
    </div>
  );
}
