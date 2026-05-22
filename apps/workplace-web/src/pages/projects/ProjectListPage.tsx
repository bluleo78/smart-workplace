import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

import { useProjects } from '../../hooks/queries/useProjects';
import { ProjectCreateDialog } from './components/ProjectCreateDialog';

// 내가 멤버인 프로젝트 목록 (ADMIN 은 전체). 우상단 "+ 새 프로젝트" 로 생성 모달.
export default function ProjectListPage() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useProjects();

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">프로젝트</h1>
        <Button onClick={() => setOpen(true)}>+ 새 프로젝트</Button>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : data && data.content.length === 0 ? (
        <p className="text-muted-foreground">아직 프로젝트가 없습니다. 우상단 버튼으로 시작하세요.</p>
      ) : (
        <ul className="space-y-2" role="list">
          {data?.content.map(p => (
            <li key={p.id}>
              <Link
                to={`/projects/${p.key}`}
                className="block p-4 border rounded hover:bg-accent transition-colors"
              >
                <div className="font-medium">
                  {p.name} <span className="text-muted-foreground">({p.key})</span>
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground mt-1">{p.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ProjectCreateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
