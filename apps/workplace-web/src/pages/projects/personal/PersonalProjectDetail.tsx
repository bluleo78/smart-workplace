// 개인 프로젝트 전용 상세 셸 — 팀과 동일 레이아웃으로 재수렴.
// 상단 팀 툴바(IssueFilterBar, 개인 옵션) + 공유 보드(IssueBoardView, 개인 컬럼·drawer cardTo)
// + 그룹핑 연동 체크리스트. URL = single source of truth: /projects/:key?view=&group=&task=
import { ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import type { IssueResponse } from '@/types/issue';
import type { ProjectResponse } from '@/types/project';

import { parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters';
import { IssueBoardView } from '../components/IssueBoardView';
import { IssueCreateDialog } from '../components/IssueCreateDialog';
import { IssueFilterBar, type IssueFilterBarOptions } from '../components/IssueFilterBar';
import { PersonalChecklistView } from './PersonalChecklistView';
import { PersonalTaskPanel } from './PersonalTaskPanel';

// 개인 보드 컬럼 — 취소 제외 3컬럼.
const PERSONAL_COLUMNS = [
  { status: 'TODO', label: '할 일' },
  { status: 'IN_PROGRESS', label: '진행 중' },
  { status: 'DONE', label: '완료' },
];

// 개인 툴바 옵션 — 사이클·유형·담당자그룹 제외, 뷰토글 'list'='체크리스트'.
const PERSONAL_FILTER_OPTIONS: IssueFilterBarOptions = {
  showCycle: false,
  showType: false,
  listLabel: '체크리스트',
  listIcon: ListChecks,
  groupOptions: [
    { value: null, label: '없음' },
    { value: 'status', label: '상태' },
    { value: 'priority', label: '우선순위' },
  ],
};

// 개인 프로젝트 상세 본체. ProjectDetailPage 에서 type==='PERSONAL' 일 때만 렌더된다.
export function PersonalProjectDetail({ project }: { project: ProjectResponse }) {
  const key = project.key;
  const [params] = useSearchParams();
  const view = parseView(params);
  const filters = parseFilters(params);
  const groupBy = parseGroupBy(params);
  const [createOpen, setCreateOpen] = useState(false);

  // 개인 보드 카드 클릭 → 같은 라우트의 ?task=N drawer 오픈(view=board 보존). 풀페이지 이동 없음.
  const cardTo = (issue: IssueResponse) => `/projects/${key}?view=board&task=${issue.number}`;

  return (
    <div className="flex h-full overflow-hidden" data-testid="personal-project-detail">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={project.name}
          actions={<Button onClick={() => setCreateOpen(true)}>+ 빠른 추가</Button>}
        />
        {/* 팀과 동일한 상단 툴바(검색·필터·그룹·뷰토글). 개인 옵션으로 사이클·유형 숨김. */}
        <div className="border-b px-6">
          <IssueFilterBar projectKey={key} options={PERSONAL_FILTER_OPTIONS} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {/* 개인 화면 본문 — 전체폭. 팀 화면은 건드리지 않음. */}
          <div className="w-full px-6 py-6">
            {view === 'board' ? (
              <IssueBoardView
                projectKey={key}
                filters={filters}
                groupBy={groupBy}
                columns={PERSONAL_COLUMNS}
                cardTo={cardTo}
              />
            ) : (
              <PersonalChecklistView projectKey={key} filters={filters} groupBy={groupBy} />
            )}
          </div>
        </div>
      </div>
      {/* 우측 상세 패널 — ?task=N 이 있을 때만 표시 */}
      <PersonalTaskPanel projectKey={key} />
      {/* 개인 프로젝트 — TASK 단일 유형(#226): 유형 select 숨김 */}
      <IssueCreateDialog projectKey={key} personal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
