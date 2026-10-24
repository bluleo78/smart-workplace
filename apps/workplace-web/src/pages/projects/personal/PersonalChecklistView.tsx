// 개인 체크리스트 뷰 — 마감 기준 섹션(지남/오늘/이번 주/예정/없음) + 완료(접힘) 하단. 본문 폭 전체를 쓴다.
// 서버가 화면 섹션 순서(checklist 정렬, WP-918)로 내려주므로 목록 끝에 닿으면 다음 페이지를 자동으로 붙인다 —
// 새 페이지는 마지막 섹션(또는 그 아래 새 섹션)에만 붙어 위 섹션이 되돌아가지 않는다.
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { LoadErrorState } from '@/components/LoadErrorState';
import { LoadMoreFooter } from '@/components/ui/load-more-footer';
import { Skeleton } from '@/components/ui/skeleton';
import { useIssueSearch } from '@/hooks/queries/useIssueSearch';
import { failedWithoutData } from '@/lib/queryFailure';
import { cn } from '@/lib/utils';
import type { IssueClientGroupBy, IssueFilters } from '@/types/issue';

import { PersonalChecklistRow } from './PersonalChecklistRow';
import { checklistOrderParams, groupChecklist } from './personalGrouping';

// 섹션 제목 — 한글 제목이라 대문자 변환·자간을 쓰지 않는다.
const SECTION_TITLE_CLASS = 'text-xs font-semibold text-muted-foreground';

// groupBy 에 따라 섹션 재구성 — null=마감 버킷(+완료 접힘), status/priority=평탄 섹션.
// scrollRoot: 목록을 감싼 스크롤 컨테이너 — 무한 로드 sentinel 의 root(DS 05 §A-3). 뷰포트를 root 로 두면 끝에 닿아도 불러오지 않는다.
export function PersonalChecklistView({
  projectKey,
  filters,
  groupBy,
  scrollRoot,
}: {
  projectKey: string;
  filters: IssueFilters;
  groupBy: IssueClientGroupBy | null;
  scrollRoot: Element | null;
}) {
  // 버킷 경계와 정렬 파라미터는 같은 now 로 — 화면 묶음과 서버 정렬이 같은 날짜를 본다.
  // 파라미터는 쿼리 키에 들어간다: 자정을 넘기거나 그룹을 바꾸면 키가 바뀌어 1페이지부터 다시 받는다(커서에 모드·날짜가 없다).
  const now = new Date();
  const q = useIssueSearch(projectKey, filters, 100, true, checklistOrderParams(groupBy, now));
  // IssueBoardView 와 동일한 방어 — items 누락 페이지가 groupChecklist 의 it.status 접근에서 throw 하지 않도록.
  const items = q.data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? [];
  const [showDone, setShowDone] = useState(false);

  // 첫 페이지 실패 — 빈 상태가 아니라 실패로 알린다(다시 부르는 동안에도 유지, 다음 페이지 실패는 LoadMoreFooter 가 맡는다).
  if (failedWithoutData(q))
    return <LoadErrorState title="작업을 불러오지 못했습니다" queries={[q]} testId="personal-error" />;
  // 로딩 — 행 높이 스켈레톤 3행(표가 아니라 TableSkeletonRows 대신).
  if (q.isPending)
    return (
      <div className="space-y-1" data-testid="personal-loading" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  if (items.length === 0) {
    // 활성 필터(검색어·상태·우선순위·라벨·담당자) 여부에 따라 빈 상태 메시지 분기
    const hasActiveFilters =
      filters.q !== '' ||
      filters.statuses.length > 0 ||
      filters.statusIds.length > 0 ||
      filters.priorities.length > 0 ||
      filters.labelIds.length > 0 ||
      filters.assigneeIds.length > 0;
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {hasActiveFilters
          ? '일치하는 작업이 없습니다.'
          : '작업이 없습니다. + 빠른 추가로 시작하세요.'}
      </p>
    );
  }

  const { sections, collapsedDone } = groupChecklist(items, groupBy, now);
  // 전부 CANCELED 등으로 섹션·완료 모두 비면 백지 대신 빈 상태 안내 — 다음 페이지가 남았으면 푸터가 이어 불러온다.
  if (sections.length === 0 && collapsedDone.length === 0)
    return (
      <>
        <p className="py-12 text-center text-sm text-muted-foreground">표시할 작업이 없습니다.</p>
        <LoadMoreFooter query={q} root={scrollRoot} data-testid="personal-more" />
      </>
    );

  // 다음 페이지가 남은 동안 마지막으로 그린 섹션(완료 접힘 포함)은 아직 자라는 중이라 건수를 숨긴다 — 그 위 섹션은 완결이라 정확하다.
  const lastKey = collapsedDone.length > 0 ? 'done' : sections[sections.length - 1]?.key;
  const countOf = (key: string, n: number) =>
    q.hasNextPage && key === lastKey ? null : (
      <span className="ml-1 text-muted-foreground" data-testid={`personal-section-count-${key}`}>{n}</span>
    );

  return (
    <div className="space-y-5" data-testid="personal-checklist">
      {sections.map((g) => (
        <section key={g.key} data-testid={`personal-section-${g.key}`}>
          <h3 className={cn('mb-1 px-2', SECTION_TITLE_CLASS)}>
            {g.label} {countOf(g.key, g.items.length)}
          </h3>
          <div className="space-y-0.5">
            {g.items.map((it) => <PersonalChecklistRow key={it.id} projectKey={projectKey} issue={it} />)}
          </div>
        </section>
      ))}
      {collapsedDone.length > 0 && (
        <section data-testid="personal-section-done">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className={cn('flex items-center gap-1 px-2 hover:text-foreground', SECTION_TITLE_CLASS)}
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showDone && 'rotate-90')} />
            완료 {countOf('done', collapsedDone.length)}
          </button>
          {showDone && (
            <div className="mt-1 space-y-0.5">
              {collapsedDone.map((it) => <PersonalChecklistRow key={it.id} projectKey={projectKey} issue={it} />)}
            </div>
          )}
        </section>
      )}
      <LoadMoreFooter query={q} root={scrollRoot} data-testid="personal-more" />
    </div>
  );
}
