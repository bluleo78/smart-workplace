// 개인 체크리스트 단일 행 — 상태아이콘(완료 토글) + 우선순위 + 제목 + 라벨 + 마감 + AI 배지.
// 행 클릭 = 우측 drawer 토글(같은 행 재클릭 시 닫힘). 인라인 펼침은 제거(상세는 drawer).
import { useSearchParams } from 'react-router-dom';

import { LabelChip } from '@/components/labels/LabelChip';
import { useUpdateIssue } from '@/hooks/queries/useIssue';
import { formatDateKorean } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';

import { IssuePriorityBadge } from '../components/IssuePriorityBadge';
import { AiDelegationBadge } from './aiDelegation';
import { PersonalStatusIcon } from './PersonalStatusIcon';

// 마감 색 — 지남=빨강, 오늘=주황(warning). 완료/없음/이후=muted.
function dueClass(due: string, done: boolean): string {
  if (done) return 'text-muted-foreground';
  const now = new Date();
  const sToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(due + 'T00:00:00');
  if (d < sToday) return 'text-destructive';
  if (d.getTime() === sToday.getTime()) return 'text-warning';
  return 'text-muted-foreground';
}

export function PersonalChecklistRow({ projectKey, issue }: { projectKey: string; issue: IssueResponse }) {
  const [params, setParams] = useSearchParams();
  const update = useUpdateIssue(projectKey, issue.number);
  const done = issue.status === 'DONE';
  const isOpen = params.get('task') === String(issue.number);

  // 상태아이콘 클릭 = 완료 토글(행 클릭 전파 차단).
  const toggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    update.mutate({ status: done ? 'TODO' : 'DONE' });
  };
  // 행 클릭 = drawer 토글(같은 행이면 닫고, 아니면 해당 이슈로 전환).
  const togglePanel = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (n.get('task') === String(issue.number)) n.delete('task');
      else n.set('task', String(issue.number));
      return n;
    }, { replace: true });

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`personal-task-row-${issue.number}`}
      data-status={issue.status}
      aria-pressed={isOpen}
      onClick={togglePanel}
      onKeyDown={(e) => {
        // Enter/Space 로 행 토글 — 내부 버튼 포커스 시 중복 발화 방지(타겟이 행 자신일 때만).
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          togglePanel();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50',
        isOpen && 'bg-muted',
      )}
    >
      <button
        type="button"
        aria-label="완료 토글"
        aria-pressed={done}
        disabled={update.isPending}
        data-testid={`personal-task-check-${issue.number}`}
        onClick={toggleDone}
        className="shrink-0"
      >
        <PersonalStatusIcon status={issue.status} />
      </button>
      {issue.priority !== 'MID' && <IssuePriorityBadge priority={issue.priority} />}
      <span className={cn('min-w-0 truncate text-sm', done && 'text-muted-foreground line-through')}>
        {issue.title}
      </span>
      {issue.labels.map((l) => (
        <span key={l.id} className="shrink-0"><LabelChip label={l} size="sm" /></span>
      ))}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {issue.dueDate && (
          <span className={cn('text-xs', dueClass(issue.dueDate, done))}>{formatDateKorean(issue.dueDate)}</span>
        )}
        <AiDelegationBadge issue={issue} />
      </div>
    </div>
  );
}
