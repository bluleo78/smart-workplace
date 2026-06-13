// 이슈 상세 — 본문 + 코멘트 + 우측 사이드바(상태/우선순위/마감일 인라인 편집 + 라벨 + watch 토글 + 활동).

import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/PageHeader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

import { CyclePickerPopover } from '../../components/cycle/CyclePickerPopover';
import { IssueTypeSelectPopover } from '../../components/issueTypes/IssueTypeSelectPopover';
import { LabelChip } from '../../components/labels/LabelChip';
import { LabelPickerPopover } from '../../components/labels/LabelPickerPopover';
import { AgentBadge } from '../../components/users/AgentBadge';
import { UserAvatar } from '../../components/users/UserAvatar';
import { useIssue, useUpdateIssue } from '../../hooks/queries/useIssue';
import { useDeleteIssue } from '../../hooks/queries/useIssues';
import { useProjectMembers } from '../../hooks/queries/useProjectMembers';
import { useProject } from '../../hooks/queries/useProjects';
import { useWatchers, useWatchToggle } from '../../hooks/queries/useWatchToggle';
import { useAuth } from '../../hooks/useAuth';
import { handleApiError } from '../../lib/api-error';
import type { UpdateIssueRequest } from '../../types/issue';
import { AssigneePickerPopover } from './components/AssigneePickerPopover';
import { IssueChatSection } from './components/chat/IssueChatSection';
import { CustomFieldsSection } from './components/CustomFieldsSection';
import { IssueActivityTimeline } from './components/IssueActivityTimeline';
import { IssueAttachmentDropzone } from './components/IssueAttachmentDropzone';
import { IssueAttachmentList } from './components/IssueAttachmentList';
import { IssueChildrenSection } from './components/IssueChildrenSection';
import { IssueCommentList } from './components/IssueCommentList';
import { IssueDependenciesSection } from './components/IssueDependenciesSection';
import { IssueParentSlot } from './components/IssueParentSlot';
import { IssuePrioritySelect } from './components/IssuePrioritySelect';
import { IssueStatusSelect } from './components/IssueStatusSelect';

// 이슈 상세 페이지 — URL 파라미터에서 프로젝트 키와 이슈 번호를 받아 단건 조회.
export default function IssueDetailPage() {
  const { key = '', number = '' } = useParams();
  const issueNumber = Number(number);
  const navigate = useNavigate();
  // 개인 프로젝트 여부 판별 — 개인 프로젝트의 이슈는 풀페이지 대신 패널로 귀결시킨다.
  const project = useProject(key);
  const { data, isLoading, refetch } = useIssue(key, issueNumber);
  const update = useUpdateIssue(key, issueNumber);
  const remove = useDeleteIssue(key, issueNumber);
  const { user } = useAuth();
  const watchers = useWatchers(key, issueNumber);
  const toggleWatch = useWatchToggle(key, issueNumber, user?.id ?? null);
  const isWatching = !!watchers.data?.some((w) => w.userId === user?.id);
  // 삭제 확인 다이얼로그 open 상태 — shadcn AlertDialog 제어형.
  const [deletePending, setDeletePending] = useState(false);
  // 첨부 삭제 권한 UI 토글용 — 첨부자 또는 OWNER. 백엔드 가드가 최종 검증.
  const members = useProjectMembers(key);
  const isOwner =
    members.data?.some((m) => m.userId === user?.id && m.role === 'OWNER') ?? false;

  // 프로젝트 타입이 확정되기 전에는 렌더 보류 — 팀 화면 반짝임 방지.
  if (project.isLoading) return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error)
    return <p className="container mx-auto p-6 text-destructive">프로젝트를 불러올 수 없습니다</p>;
  // 개인 프로젝트의 이슈 풀페이지 진입(알림/북마크)은 프로젝트 화면의 우측 패널로 리다이렉트한다.
  // 팀 프로젝트는 기존 풀페이지 유지.
  if (project.data?.type === 'PERSONAL') {
    return <Navigate to={`/projects/${key}?task=${issueNumber}`} replace />;
  }

  if (isLoading) return <p className="container mx-auto p-6 text-muted-foreground">로딩 중…</p>;
  if (!data) return (
    <div className="container mx-auto p-6 text-center">
      <p className="text-sm text-destructive mb-2">태스크를 찾을 수 없습니다</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
    </div>
  );

  const { summary, body, comments, history } = data;
  // SUBTASK 여부 — 부모 슬롯(SUBTASK 만) / 자식 섹션(비SUBTASK 만) 분기에 사용 (Phase 4a).
  const isSubtask = summary.type?.name === 'SUBTASK';

  // 삭제 — cascade soft-delete. childCount > 0 이면 AlertDialog 경고 문구에 자식 수 포함.
  // 성공 시 프로젝트 보드로 이동. 권한(첨부자/OWNER) 검증은 백엔드가 수행.
  const onDelete = () => setDeletePending(true);
  const onDeleteConfirm = () => {
    remove.mutate(undefined, {
      onSuccess: () => navigate(`/projects/${key}`),
    });
  };

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
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={<span className="truncate">{summary.title}</span>}
        meta={
          <>
            <span className="text-sm font-mono text-muted-foreground">
              {summary.projectKey}-{summary.number}
            </span>
            {summary.type && (
              <IssueTypeSelectPopover
                projectKey={key}
                issueNumber={issueNumber}
                current={summary.type}
              />
            )}
            {/* Phase 4b — blockedBy 중 미완료 존재 시 헤더에 차단됨 배지 노출. */}
            {summary.blocked && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/15 text-destructive text-xs"
                data-testid="issue-blocked-badge"
              >
                ⛔ 차단됨
              </span>
            )}
          </>
        }
        actions={
          <>
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
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              aria-label="태스크 삭제"
              data-testid="issue-delete"
              disabled={remove.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              삭제
            </Button>
          </>
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-6 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          <div className="space-y-4">
            <article className="prose dark:prose-invert max-w-none whitespace-pre-wrap">
              {body ?? <em className="text-muted-foreground">본문 없음</em>}
            </article>
            {/* 비SUBTASK 상세 본문 아래 — 자식 SUBTASK 진행률/목록/인라인 추가 (Phase 4a). */}
            {!isSubtask && (
              <IssueChildrenSection
                projectKey={key}
                parentNumber={issueNumber}
                childCount={summary.childCount}
                childDoneCount={summary.childDoneCount}
              />
            )}
            <IssueCommentList
              projectKey={key}
              issueNumber={issueNumber}
              issueId={summary.id}
              comments={comments}
            />
            <IssueChatSection projectKey={key} issueNumber={issueNumber} />
          </div>
          <aside className="space-y-4">
            {/* SUBTASK 상세에서만 부모 슬롯 노출 (Phase 4a). */}
            {isSubtask && (
              <IssueParentSlot
                projectKey={key}
                issueNumber={issueNumber}
                parent={summary.parent}
              />
            )}
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
                      {u.kind === 'AGENT' && <AgentBadge size="xs" />}
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
            {/* 사이클 피커 — 이슈에 연결된 사이클 조회·변경 (CyclePickerPopover) */}
            <section data-testid="issue-cycles-section">
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">사이클</h3>
              <CyclePickerPopover projectKey={key} issueNumber={issueNumber} />
            </section>
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
            {/* Phase 4b — 의존성 두 슬롯(차단됨/차단 중) + Picker. */}
            <IssueDependenciesSection
              projectKey={key}
              issueNumber={issueNumber}
              blockedBy={summary.blockedBy}
              blocks={summary.blocks}
            />
            {/* Phase 4c — 프로젝트 커스텀 필드 인라인 편집. 정의 없으면 null. */}
            <CustomFieldsSection
              projectKey={key}
              issueNumber={issueNumber}
              current={summary.customFields}
            />
            <div>
              <h3 className="text-sm font-semibold mb-2">활동</h3>
              <IssueActivityTimeline entries={history} />
            </div>
          </aside>
        </div>
      </div>
      {/* 삭제 확인 AlertDialog — window.confirm() 대체. childCount > 0 시 자식 수 경고 포함. */}
      <AlertDialog open={deletePending} onOpenChange={setDeletePending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>태스크 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              {summary.childCount > 0
                ? `이 태스크에는 하위 태스크가 ${summary.childCount}개 있습니다. 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
                : '이 태스크를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDeleteConfirm}>삭제</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
