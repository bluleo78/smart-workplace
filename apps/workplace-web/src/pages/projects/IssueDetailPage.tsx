// 이슈 상세 — 본문 + 코멘트 + 우측 사이드바(상태/우선순위/마감일 인라인 편집 + 활동 타임라인).

import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useIssue, useUpdateIssue } from '../../hooks/queries/useIssue';
import { handleApiError } from '../../lib/api-error';
import type { UpdateIssueRequest } from '../../types/issue';

import { IssueActivityTimeline } from './components/IssueActivityTimeline';
import { IssueCommentList } from './components/IssueCommentList';
import { IssuePrioritySelect } from './components/IssuePrioritySelect';
import { IssueStatusSelect } from './components/IssueStatusSelect';

// 이슈 상세 페이지 — URL 파라미터에서 프로젝트 키와 이슈 번호를 받아 단건 조회.
export default function IssueDetailPage() {
  const { key = '', number = '' } = useParams();
  const issueNumber = Number(number);
  const { data, isLoading } = useIssue(key, issueNumber);
  const update = useUpdateIssue(key, issueNumber);

  if (isLoading) return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;
  if (!data) return <p className="container mx-auto p-6 text-destructive">이슈를 찾을 수 없습니다</p>;

  const { summary, body, comments, history } = data;

  // 인라인 편집 patch — 단일 필드 변경마다 호출되며 onSuccess invalidate 로 detail 재조회.
  const patch = async (changes: UpdateIssueRequest) => {
    try {
      await update.mutateAsync(changes);
      toast.success('변경 완료');
    } catch (e) {
      handleApiError(e, '변경에 실패했습니다');
    }
  };

  return (
    <div className="container mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
      <div className="space-y-4">
        <div>
          <p className="text-sm font-mono text-muted-foreground">
            {summary.projectKey}-{summary.number}
          </p>
          <h1 className="text-2xl font-semibold">{summary.title}</h1>
        </div>
        <article className="prose dark:prose-invert max-w-none whitespace-pre-wrap">
          {body ?? <em className="text-muted-foreground">본문 없음</em>}
        </article>
        <IssueCommentList
          projectKey={key}
          issueNumber={issueNumber}
          issueId={summary.id}
          comments={comments}
        />
      </div>
      <aside className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">상태</label>
          <IssueStatusSelect
            value={summary.status}
            onChange={(v) => patch({ status: v })}
            disabled={update.isPending}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">우선순위</label>
          <IssuePrioritySelect
            value={summary.priority}
            onChange={(v) => patch({ priority: v })}
            disabled={update.isPending}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground" htmlFor="issue-due-edit">마감일</label>
          <input
            id="issue-due-edit"
            type="date"
            className="w-full border rounded p-2 bg-background"
            value={summary.dueDate ?? ''}
            disabled={update.isPending}
            onChange={(e) => patch({
              dueDate: e.target.value || undefined,
              clearDueDate: !e.target.value,
            })}
          />
        </div>
        <div>
          <h3 className="text-sm font-semibold mb-2">활동</h3>
          <IssueActivityTimeline entries={history} />
        </div>
      </aside>
    </div>
  );
}
