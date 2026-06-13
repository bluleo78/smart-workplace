// 개인 체크리스트 단일 행 — 완료 토글 + 제목 + 마감 + AI 배지. (인라인 펼침은 Task 4 에서 추가)
import { useSearchParams } from 'react-router-dom';

import { useUpdateIssue } from '@/hooks/queries/useIssue';
import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';

import { AiDelegationBadge } from './aiDelegation';

export function PersonalChecklistRow({ projectKey, issue }: { projectKey: string; issue: IssueResponse }) {
  const [, setParams] = useSearchParams();
  const update = useUpdateIssue(projectKey, issue.number);
  const done = issue.status === 'DONE';

  // 원형 체크 토글 — 완료 ↔ 할 일.
  const toggleDone = () => update.mutate({ status: done ? 'TODO' : 'DONE' });
  // 행 클릭 → 우측 패널 오픈(Task 5). 지금은 ?task=N 만 설정.
  const openPanel = () => {
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('task', String(issue.number));
        return n;
      },
      { replace: true },
    );
  };

  return (
    <div
      data-testid={`personal-task-row-${issue.number}`}
      className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
    >
      <button
        type="button"
        aria-label="완료 토글"
        aria-pressed={done}
        disabled={update.isPending}
        data-testid={`personal-task-check-${issue.number}`}
        onClick={toggleDone}
        className={cn(
          'h-4 w-4 shrink-0 rounded-full border-[1.5px]',
          done ? 'bg-muted-foreground/40 border-muted-foreground/40' : 'border-muted-foreground/60',
        )}
      />
      <button
        type="button"
        onClick={openPanel}
        className={cn('flex-1 truncate text-left text-sm', done && 'text-muted-foreground line-through')}
      >
        {issue.title}
      </button>
      {issue.dueDate && <span className="shrink-0 text-xs text-muted-foreground">{issue.dueDate}</span>}
      <AiDelegationBadge issue={issue} />
    </div>
  );
}
