// 개인 프로젝트 전용 상세 셸 — 헤더(빠른 추가) + 체크리스트⇄보드 토글 + 본문 + 우측 패널.
// 레이아웃만 신규이고 필드 위젯/데이터 훅은 기존 컴포넌트 재사용. URL: /projects/:key?view=&task=
import { LayoutGrid, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ProjectResponse } from '@/types/project';

import { parseFilters, parseView } from '../../../lib/issueFilters';
import { IssueCreateDialog } from '../components/IssueCreateDialog';
import { PersonalBoardView } from './PersonalBoardView';
import { PersonalChecklistView } from './PersonalChecklistView';
import { PersonalTaskPanel } from './PersonalTaskPanel';

// 개인 프로젝트 상세 본체. ProjectDetailPage 에서 type==='PERSONAL' 일 때만 렌더된다.
export function PersonalProjectDetail({ project }: { project: ProjectResponse }) {
  const key = project.key;
  const [params, setParams] = useSearchParams();
  const view = parseView(params); // 'list'(기본) | 'board'
  const filters = parseFilters(params);
  const [createOpen, setCreateOpen] = useState(false);

  // 뷰 전환 — 다른 쿼리(task 등)는 보존한 채 view 만 갱신.
  const setView = (next: 'list' | 'board') => {
    const p = new URLSearchParams(params);
    if (next === 'list') p.delete('view');
    else p.set('view', 'board');
    setParams(p, { replace: true });
  };

  return (
    <div className="flex h-full overflow-hidden" data-testid="personal-project-detail">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={project.name}
          actions={<Button onClick={() => setCreateOpen(true)}>+ 빠른 추가</Button>}
        />
        <div className="border-b px-6 pb-3">
          {/* 체크리스트(기본) ⇄ 보드 토글 — Todoist/TickTick 식 경량 토글 */}
          <div className="inline-flex gap-1 rounded-md border p-0.5" data-testid="personal-view-toggle">
            <ToggleButton active={view !== 'board'} onClick={() => setView('list')}
              testId="personal-view-checklist" icon={<ListChecks className="h-4 w-4" />} label="체크리스트" />
            <ToggleButton active={view === 'board'} onClick={() => setView('board')}
              testId="personal-view-board" icon={<LayoutGrid className="h-4 w-4" />} label="보드" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto p-6">
            {view === 'board' ? (
              <PersonalBoardView projectKey={key} filters={filters} />
            ) : (
              <PersonalChecklistView projectKey={key} filters={filters} />
            )}
          </div>
        </div>
      </div>
      {/* 우측 상세 패널 — ?task=N 이 있을 때만 표시 */}
      <PersonalTaskPanel projectKey={key} />
      <IssueCreateDialog projectKey={key} open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// 토글 버튼 — 활성 시 강조.
function ToggleButton({ active, onClick, testId, icon, label }: {
  active: boolean; onClick: () => void; testId: string; icon: React.ReactNode; label: string;
}) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} aria-pressed={active}
      className={cn('flex items-center gap-1.5 rounded px-3 py-1 text-sm',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
      {icon}{label}
    </button>
  );
}
