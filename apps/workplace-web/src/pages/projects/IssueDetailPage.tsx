// 이슈 상세 — 본문 + 코멘트 + 우측 사이드바(상태/우선순위/마감일 인라인 편집 + 라벨 + watch 토글 + 활동).

import { Eye, EyeOff } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { LabelChip } from '../../components/labels/LabelChip';
import { LabelPickerPopover } from '../../components/labels/LabelPickerPopover';
import { UserAvatar } from '../../components/users/UserAvatar';
import { useIssue, useUpdateIssue } from '../../hooks/queries/useIssue';
import { useProjectMembers } from '../../hooks/queries/useProjectMembers';
import { useWatchers, useWatchToggle } from '../../hooks/queries/useWatchToggle';
import { useAuth } from '../../hooks/useAuth';
import { handleApiError } from '../../lib/api-error';
import type { UpdateIssueRequest } from '../../types/issue';

import { IssueTypeSelectPopover } from '../../components/issueTypes/IssueTypeSelectPopover';

import { AssigneePickerPopover } from './components/AssigneePickerPopover';
import { IssueActivityTimeline } from './components/IssueActivityTimeline';
import { IssueAttachmentDropzone } from './components/IssueAttachmentDropzone';
import { IssueAttachmentList } from './components/IssueAttachmentList';
import { IssueCommentList } from './components/IssueCommentList';
import { IssuePrioritySelect } from './components/IssuePrioritySelect';
import { IssueStatusSelect } from './components/IssueStatusSelect';

// 이슈 상세 페이지 — URL 파라미터에서 프로젝트 키와 이슈 번호를 받아 단건 조회.
export default function IssueDetailPage() {
  const { key = '', number = '' } = useParams();
  const issueNumber = Number(number);
  const { data, isLoading } = useIssue(key, issueNumber);
  const update = useUpdateIssue(key, issueNumber);
  const { user } = useAuth();
  const watchers = useWatchers(key, issueNumber);
  const toggleWatch = useWatchToggle(key, issueNumber, user?.id ?? null);
  const isWatching = !!watchers.data?.some((w) => w.userId === user?.id);
  // 첨부 삭제 권한 UI 토글용 — 첨부자 또는 OWNER. 백엔드 가드가 최종 검증.
  const members = useProjectMembers(key);
  const isOwner =
    members.data?.some((m) => m.userId === user?.id && m.role === 'OWNER') ?? false;

  if (isLoading) return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;
  if (!data) return <p className="container mx-auto p-6 text-destructive">태스크를 찾을 수 없습니다</p>;

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
          <div className="flex items-center gap-3 flex-wrap">
            {summary.type && (
              <IssueTypeSelectPopover
                projectKey={key}
                issueNumber={issueNumber}
                current={summary.type}
              />
            )}
            <h1 className="text-2xl font-semibold">{summary.title}</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleWatch.mutate(!isWatching)}
              aria-pressed={isWatching}
              aria-label={isWatching ? '구독 중' : '구독'}
              data-testid="watch-toggle"
              disabled={toggleWatch.isPending}
            >
              {isWatching ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
              {isWatching ? '구독 중' : '구독'}
              <span className="ml-1 text-xs text-muted-foreground">
                {watchers.data?.length ?? 0}
              </span>
            </Button>
          </div>
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
        <section aria-label="담당자" className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">담당자</span>
            <AssigneePickerPopover
              projectKey={key}
              issueNumber={issueNumber}
              current={summary.assignees}
            />
          </div>
          <div className="flex flex-wrap gap-2" data-testid="issue-assignees">
            {summary.assignees.length === 0 ? (
              <span className="text-xs text-muted-foreground">미지정</span>
            ) : (
              summary.assignees.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1 text-sm"
                  data-testid={`issue-assignee-${u.id}`}
                >
                  <UserAvatar user={u} size="sm" />
                  <span>{u.name}</span>
                </span>
              ))
            )}
          </div>
        </section>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">라벨</span>
            <LabelPickerPopover
              projectKey={key}
              issueNumber={issueNumber}
              current={summary.labels}
            />
          </div>
          <div className="flex flex-wrap gap-1" data-testid="issue-labels">
            {summary.labels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
            {summary.labels.length === 0 && (
              <span className="text-xs text-muted-foreground">없음</span>
            )}
          </div>
        </div>
        <section aria-label="첨부" className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">첨부</span>
            <span className="text-xs text-muted-foreground">
              {summary.attachmentCount}/10
            </span>
          </div>
          <IssueAttachmentDropzone
            projectKey={key}
            number={issueNumber}
            currentCount={summary.attachmentCount}
            disabled={summary.attachmentCount >= 10}
          />
          <IssueAttachmentList
            projectKey={key}
            number={issueNumber}
            currentUserId={user?.id ?? null}
            isOwner={isOwner}
          />
        </section>
        <div>
          <h3 className="text-sm font-semibold mb-2">활동</h3>
          <IssueActivityTimeline entries={history} />
        </div>
      </aside>
    </div>
  );
}
