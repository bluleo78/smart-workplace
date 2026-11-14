// 개인 체크리스트 단일 행 — 상태아이콘(완료 토글) + 우선순위 + 제목 + 레이블 + (오른쪽) AI 배지 · 마감.
// 행 클릭 = 우측 drawer 토글(같은 행 재클릭 시 닫힘). 인라인 펼침은 제거(상세는 drawer).
// 행 자신은 버튼이 아니다 — 행 전체 클릭은 마우스·터치 편의이고 키보드 접근점은 제목 버튼이다(IssueTableRow 와 같은 방식).
// 행을 role=button 으로 두면 안의 「완료 토글」과 버튼 안 버튼(중첩 인터랙티브)이 된다(WP-1544).
// 상태를 맨 앞에 둔다 — 다른 목록(프로젝트 이슈 목록·내 작업)과 같은 읽는 순서다(WP-918).
import { useRef } from 'react';

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
  const titleRef = useRef<HTMLButtonElement>(null);

  // 상태아이콘 클릭 = 완료 토글(행 클릭 전파 차단).
  const toggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    update.mutate({ status: done ? 'TODO' : 'DONE' });
  };
  // 행 클릭 = drawer 토글. 열기는 push(시스템 뒤로가기가 패널만 닫음), 다른 행이면 replace 전환,
  // 같은 행 재클릭은 연 항목을 되돌려 닫는다 — 예전 replace 열기의 "죽은 back"(뒤로가기가 개인작업을 떠남) 제거(WP-208).
  const togglePanel = () => (isOpen ? taskParam.close() : taskParam.open(String(issue.number)));
  // 행 onClick 이 유일한 토글 경로다 — 제목 버튼의 클릭·Enter·Space 도 네이티브 click 으로 여기까지 버블한다(WP-1544).
  // 진행 중(disabled)인 완료 토글 위의 클릭은 무시하고, 어디를 눌러 열어도 제목 버튼에 포커스를 둔다 —
  // 행은 포커스를 받지 않으니 모달이 닫힐 때 포커스가 <body> 로 떨어지지 않고 제목 버튼으로 돌아오게.
  const onRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button:disabled')) return;
    titleRef.current?.focus({ preventScroll: true });
    togglePanel();
  };

  return (
    // 바깥 = @container — 레이블 숨김을 행 폭(40rem)으로 정한다(WP-505 규칙, 패널이 열려 목록이 좁아지면 레이블부터 접힌다).
    <div
      data-testid={`personal-task-row-${issue.number}`}
      data-status={issue.status}
      data-priority={issue.priority}
      onClick={onRowClick}
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
          // 누름 영역 24×24 이상(WCAG 2.5.8, WP-1544) — 아이콘 크기는 그대로 두고 버튼만 키워 가운데 놓는다.
          // 음수 여백으로 늘어난 만큼 상쇄해 행 높이·간격이 바뀌지 않게 한다.
          className="-m-[3px] inline-flex size-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IssueStatusIcon status={issue.status} name={issue.statusName} color={issue.statusColor} />
        </button>
        <IssuePriorityBars priority={issue.priority} />
        {/* 제목은 한 줄 말줄임 + 최소 폭 — 레이블·마감이 제목을 다 밀어내지 않게(데스크톱 8rem, 모바일 7rem).
            상세 모달을 여닫으므로 aria-haspopup=dialog + aria-expanded. 자체 onClick 은 없다 — 행 onClick 으로 버블해 한 번만 토글된다. */}
        <button
          ref={titleRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          data-testid={`personal-task-open-${issue.number}`}
          className={cn(
            'truncate rounded text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isMobile ? 'min-w-[7rem]' : 'min-w-[8rem]',
            done && 'text-muted-foreground line-through',
          )}
        >
          {issue.title}
        </button>
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
