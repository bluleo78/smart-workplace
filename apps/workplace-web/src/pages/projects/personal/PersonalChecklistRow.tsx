// 개인 체크리스트 단일 행 — 상태아이콘(완료 토글) + 우선순위 + 제목 + 레이블 + (오른쪽) AI 배지 · 마감.
// 행 클릭 = 우측 drawer 토글(같은 행 재클릭 시 닫힘). 인라인 펼침은 제거(상세는 drawer).
// 상태를 맨 앞에 둔다 — 다른 목록(프로젝트 이슈 목록·내 작업)과 같은 읽는 순서다(WP-918).
import { AiDelegationBadge } from '@/components/ai/agentWork/AiDelegationBadge';
import { IssueLabelMeta } from '@/components/issue/IssueLabelMeta';
import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon';
import { useUpdateIssue } from '@/hooks/queries/useIssue';
import { useHistoryParam } from '@/hooks/useHistoryParam';
import { useIsMobile } from '@/hooks/useIsMobile';
import { SELECTED_BG_CLASS } from '@/lib/selectionStyles';
import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';

import { dueClass, formatDueShort } from './personalDue';

export function PersonalChecklistRow({ projectKey, issue }: { projectKey: string; issue: IssueResponse }) {
  const taskParam = useHistoryParam('task');
  const update = useUpdateIssue(projectKey, issue.number);
  const isMobile = useIsMobile();
  const done = issue.status === 'DONE';
  const isOpen = taskParam.value === String(issue.number);

  // 상태아이콘 클릭 = 완료 토글(행 클릭 전파 차단).
  const toggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    update.mutate({ status: done ? 'TODO' : 'DONE' });
  };
  // 행 클릭 = drawer 토글. 열기는 push(시스템 뒤로가기가 패널만 닫음), 다른 행이면 replace 전환,
  // 같은 행 재클릭은 연 항목을 되돌려 닫는다 — 예전 replace 열기의 "죽은 back"(뒤로가기가 개인작업을 떠남) 제거(WP-208).
  const togglePanel = () => (isOpen ? taskParam.close() : taskParam.open(String(issue.number)));

  return (
    // 바깥 = @container — 레이블 숨김을 행 폭(40rem)으로 정한다(WP-505 규칙, 패널이 열려 목록이 좁아지면 레이블부터 접힌다).
    <div
      role="button"
      tabIndex={0}
      data-testid={`personal-task-row-${issue.number}`}
      data-status={issue.status}
      data-priority={issue.priority}
      aria-pressed={isOpen}
      onClick={togglePanel}
      onKeyDown={(e) => {
        // Enter/Space 로 행 토글 — 내부 버튼 포커스 시 중복 발화 방지(타겟이 행 자신일 때만).
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          togglePanel();
        }
      }}
      className={cn('@container cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent', isOpen && SELECTED_BG_CLASS)}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          aria-label="완료 토글"
          aria-pressed={done}
          disabled={update.isPending}
          data-testid={`personal-task-check-${issue.number}`}
          onClick={toggleDone}
          className="shrink-0"
        >
          <IssueStatusIcon status={issue.status} name={issue.statusName} color={issue.statusColor} />
        </button>
        <IssuePriorityBars priority={issue.priority} />
        {/* 제목은 한 줄 말줄임 + 최소 폭 — 레이블·마감이 제목을 다 밀어내지 않게(데스크톱 8rem, 모바일 7rem). */}
        <span
          data-testid={`personal-task-title-${issue.number}`}
          className={cn(
            'truncate text-sm',
            isMobile ? 'min-w-[7rem]' : 'min-w-[8rem]',
            done && 'text-muted-foreground line-through',
          )}
        >
          {issue.title}
        </span>
        {/* 레이블 — 데스크톱은 2개 + +N(행 폭 40rem 미만이면 숨김), 모바일은 1개 + +N 을 항상 보인다. */}
        <IssueLabelMeta
          labels={issue.labels}
          max={isMobile ? 1 : 2}
          collapse={isMobile ? 'none' : 'container'}
          className="shrink-0"
          testId={`personal-task-labels-${issue.number}`}
        />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AiDelegationBadge issue={issue} />
          {issue.dueDate && (
            <span className={cn('text-xs', dueClass(issue.dueDate, done))}>{formatDueShort(issue.dueDate)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
