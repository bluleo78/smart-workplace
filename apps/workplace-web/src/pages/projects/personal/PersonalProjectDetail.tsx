// 개인 프로젝트 전용 상세 셸 — 팀과 동일 레이아웃으로 재수렴.
// 상단 팀 툴바(IssueFilterBar, 개인 옵션) + 공유 보드(IssueBoardView, 개인 컬럼·drawer cardTo)
// + 그룹핑 연동 체크리스트. URL = single source of truth: /projects/:key?view=&group=&task=
import { ListChecks, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Page, pageGutterClass } from '@/components/layout/Page';
import { HeaderIconAction } from '@/components/mobile/HeaderIconAction';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';
import type { ProjectResponse } from '@/types/project';

import { parseFilters, parseGroupBy, parseView, toClientGroupBy } from '../../../lib/issueFilters';
import { IssueBoardView } from '../components/IssueBoardView';
import { IssueCreateDialog } from '../components/IssueCreateDialog';
import { IssueFilterBar } from '../components/IssueFilterBar';
import { MobileIssueToolbar } from '../components/mobile/MobileIssueToolbar';
import type { IssueFilterBarOptions } from '../hooks/useIssueFilterControls';
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
  showClosedToggle: false,
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
  const isMobile = useIsMobile();
  const key = project.key;
  const [params] = useSearchParams();
  const view = parseView(params);
  // 개인 뷰는 기존대로 최상위 이슈만 — topLevel 기본값이 팀 보드·목록 기본 범위(에픽 제외·하위 노출)로 바뀌어도
  // 개인 보드/체크리스트의 노출 범위는 유지한다.
  const filters = { ...parseFilters(params), topLevel: true };
  // 개인 화면엔 사이클이 없다 — URL 에 group=cycle 이 와도(팀 링크 복사 등) 그룹 없음으로 본다.
  const groupBy = toClientGroupBy(parseGroupBy(params));
  const [createOpen, setCreateOpen] = useState(false);

  // 개인 보드 카드 클릭 → 같은 라우트의 ?task=N drawer 오픈(view=board 보존). 풀페이지 이동 없음.
  // 기존 URLSearchParams 를 복제해 병합(#616) — priority 등 활성 필터 파라미터가 유실되지 않도록 한다.
  const cardTo = (issue: IssueResponse) => {
    const next = new URLSearchParams(params);
    next.set('view', 'board');
    next.set('task', String(issue.number));
    return `/projects/${key}?${next.toString()}`;
  };

  return (
    // 페이지 틀 — 헤더는 전체 폭, 그 아래 본문이 [목록 칸 | 작업 패널] 로 나뉜다.
    // 작업 패널은 헤더 옆(화면 맨 위)이 아니라 헤더 아래 본문 안 보조 칸 — 앱 사이드 패널처럼 보이지 않게.
    <Page data-testid="personal-project-detail">
      <Page.Header
        title={project.name}
        actions={<Button onClick={() => setCreateOpen(true)}>+ 빠른 추가</Button>}
        // 모바일: 단일 주 액션은 ＋ 아이콘으로 인라인(⋯ 없음).
        mobilePrimaryAction={<HeaderIconAction label="빠른 추가" onClick={() => setCreateOpen(true)}><Plus /></HeaderIconAction>}
        mobileActions={null}
      />
      <Page.Body padded={false} className="overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* 팀과 동일한 상단 툴바(검색·필터·그룹·뷰토글). 개인 옵션으로 사이클·유형 숨김.
              모바일은 팀과 같은 한 줄 툴바(WP-221) — 저장 뷰·에픽이 없으므로 뷰 칩·에픽 칩 없이. */}
          <div className={cn('border-b', pageGutterClass)}>
            {isMobile ? (
              <MobileIssueToolbar projectKey={key} options={PERSONAL_FILTER_OPTIONS} showViewChip={false} />
            ) : (
              <IssueFilterBar projectKey={key} options={PERSONAL_FILTER_OPTIONS} />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* 개인 화면 본문 — 전체폭. 좌우 여백은 헤더와 같은 페이지 여백(pageGutterClass) 축.
                보드는 h-full 로 높이를 받아 자체 스크롤(컬럼 헤더 sticky·가로 스크롤바 하단 고정 — 팀 보드와 동일),
                모바일(<lg)은 탭이 상단에 붙도록 위·아래 여백을 줄인다(WP-195). 체크리스트는 콘텐츠 높이대로 늘어나 바깥 래퍼가 스크롤한다. */}
            <div className={cn('w-full py-6', pageGutterClass, view === 'board' && 'h-full max-lg:pt-2 max-lg:pb-0')}>
              {view === 'board' ? (
                <IssueBoardView
                  projectKey={key}
                  filters={filters}
                  groupBy={groupBy}
                  columns={PERSONAL_COLUMNS}
                  cardTo={cardTo}
                  showType={false}
                  onOpenCreate={() => setCreateOpen(true)}
                />
              ) : (
                <PersonalChecklistView projectKey={key} filters={filters} groupBy={groupBy} />
              )}
            </div>
          </div>
        </div>
        {/* 우측 상세 — 리스트/체크리스트=본문 안 보조 칸(헤더 아래), 보드=중앙 모달(#231). */}
        <PersonalTaskPanel projectKey={key} mode={view === 'board' ? 'modal' : 'panel'} />
      </Page.Body>
      {/* 개인 프로젝트 — TASK 단일 유형(#226): 유형 select 숨김 */}
      <IssueCreateDialog projectKey={key} personal open={createOpen} onOpenChange={setCreateOpen} />
    </Page>
  );
}
