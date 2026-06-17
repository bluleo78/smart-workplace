import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useProjects } from '../../hooks/queries/useProjects';
import { ProjectCreateDialog } from './components/ProjectCreateDialog';

// 내가 멤버인 프로젝트 목록 (ADMIN 은 전체). 우상단 "+ 새 프로젝트" 로 생성 모달.
export default function ProjectListPage() {
  const [open, setOpen] = useState(false);
  // isError/refetch 구조분해 — API 실패 시 오류 상태와 재시도 버튼 표시
  const { data, isLoading, isError, refetch } = useProjects();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="프로젝트"
        actions={<Button onClick={() => setOpen(true)}>+ 새 프로젝트</Button>}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto space-y-4 p-6">
          {isLoading ? (
            // 로딩 중 — 스켈레톤 카드 3개로 레이아웃 시프트 최소화
            <div className="space-y-2" data-testid="projects-loading">
              {[0, 1, 2].map(i => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : isError ? (
            <div className="text-center p-6">
              <p className="text-sm text-destructive mb-2">프로젝트 목록을 불러오지 못했습니다.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
            </div>
          ) : data && data.content.length === 0 ? (
            // 빈 상태 — 디자인 시스템 §2.5: 아이콘 + 제목 + 설명 + CTA 4요소
            <div
              className="flex flex-col items-center gap-3 py-16 text-center"
              data-testid="projects-empty"
            >
              <FolderOpen className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-semibold">아직 프로젝트가 없어요</p>
              <p className="text-xs text-muted-foreground">팀원과 함께 작업할 프로젝트를 만들어 보세요.</p>
              <Button onClick={() => setOpen(true)}>새 프로젝트 만들기</Button>
            </div>
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
        </div>
      </div>
      <ProjectCreateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
