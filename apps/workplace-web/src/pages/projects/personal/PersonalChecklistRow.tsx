// 개인 체크리스트 단일 행 — 완료 토글 + 제목 + 마감 + AI 배지 + 인라인 펼침(빠른 편집).
import { useSearchParams } from 'react-router-dom';

import { LabelPickerPopover } from '@/components/labels/LabelPickerPopover';
import { useUpdateIssue } from '@/hooks/queries/useIssue';
import { cn } from '@/lib/utils';
import type { IssueResponse } from '@/types/issue';

import { IssuePrioritySelect } from '../components/IssuePrioritySelect';
import { IssueStatusSelect } from '../components/IssueStatusSelect';
import { AiDelegationBadge } from './aiDelegation';

export function PersonalChecklistRow({ projectKey, issue, expanded, onToggleExpand }: {
  projectKey: string; issue: IssueResponse; expanded: boolean; onToggleExpand: () => void;
}) {
  const [, setParams] = useSearchParams();
  const update = useUpdateIssue(projectKey, issue.number);
  const done = issue.status === 'DONE';

  const toggleDone = () => update.mutate({ status: done ? 'TODO' : 'DONE' });
  // "자세히 보기" → 우측 패널 오픈(?task=N).
  const openPanel = () =>
    setParams((p) => { const n = new URLSearchParams(p); n.set('task', String(issue.number)); return n; }, { replace: true });

  return (
    <div className="rounded-md hover:bg-muted/50">
      <div data-testid={`personal-task-row-${issue.number}`} className="flex items-center gap-3 px-2 py-2">
        <button type="button" aria-label="완료 토글" aria-pressed={done} disabled={update.isPending}
          data-testid={`personal-task-check-${issue.number}`} onClick={toggleDone}
          className={cn('h-4 w-4 shrink-0 rounded-full border-[1.5px]',
            done ? 'bg-muted-foreground/40 border-muted-foreground/40' : 'border-muted-foreground/60')} />
        <button type="button" onClick={onToggleExpand}
          aria-expanded={expanded} aria-controls={`personal-task-inline-id-${issue.number}`}
          className={cn('flex-1 truncate text-left text-sm', done && 'text-muted-foreground line-through')}>
          {issue.title}
        </button>
        {issue.dueDate && <span className="shrink-0 text-xs text-muted-foreground">{issue.dueDate}</span>}
        <AiDelegationBadge issue={issue} />
      </div>
      {expanded && (
        <div id={`personal-task-inline-id-${issue.number}`} data-testid={`personal-task-inline-${issue.number}`}
          className="ml-9 mr-2 mb-2 space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <IssueStatusSelect value={issue.status} disabled={update.isPending} onChange={(v) => update.mutate({ status: v })} />
            <IssuePrioritySelect value={issue.priority} disabled={update.isPending} onChange={(v) => update.mutate({ priority: v })} />
            <LabelPickerPopover projectKey={projectKey} issueNumber={issue.number} current={issue.labels} />
          </div>
          <button type="button" data-testid={`personal-task-detail-link-${issue.number}`} onClick={openPanel}
            className="text-xs text-muted-foreground hover:text-foreground">자세히 보기 →</button>
        </div>
      )}
    </div>
  );
}
