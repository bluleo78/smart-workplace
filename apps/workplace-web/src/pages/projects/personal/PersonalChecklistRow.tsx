// 개인 체크리스트 단일 행 — 상태아이콘(완료 토글) + 우선순위 + 제목 + 라벨 + 마감 + AI 배지.
// 행 클릭 = 우측 drawer 토글(같은 행 재클릭 시 닫힘). 인라인 펼침은 제거(상세는 drawer).
import { useSearchParams } from 'react-router-dom';

import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars';
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon';
import { useUpdateIssue } from '@/hooks/queries/useIssue';
import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';

import { AiDelegationBadge } from './aiDelegation';

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

// 마감 짧게 — 오늘/내일/어제, 그 외 "M월 D일"(다른 해는 연도 포함).
function formatDueShort(due: string): string {
  const now = new Date();
  const d = new Date(due + 'T00:00:00');
  const sToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d.getTime() - sToday.getTime()) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}월 ${d.getDate()}일`
    : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
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
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50',
        isOpen && 'bg-muted',
      )}
    >
      <IssuePriorityBars priority={issue.priority} />
      <button
        type="button"
        aria-label="완료 토글"
        aria-pressed={done}
        disabled={update.isPending}
        data-testid={`personal-task-check-${issue.number}`}
        onClick={toggleDone}
        className="shrink-0"
      >
        <IssueStatusIcon status={issue.status} />
      </button>
      <span className={cn('min-w-0 truncate text-sm', done && 'text-muted-foreground line-through')}>
        {issue.title}
      </span>
      {issue.labels.map((l) => (
        <span key={l.id} className="shrink-0 rounded border border-border px-1.5 text-[11px] leading-5 text-muted-foreground">{l.name}</span>
      ))}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <AiDelegationBadge issue={issue} />
        {issue.dueDate && (
          <span className={cn('text-xs', dueClass(issue.dueDate, done))}>{formatDueShort(issue.dueDate)}</span>
        )}
      </div>
    </div>
  );
}
