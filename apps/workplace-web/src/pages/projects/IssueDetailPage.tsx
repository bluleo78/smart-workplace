// 이슈 상세 — 본문 + 코멘트 + 우측 사이드바(상태/우선순위/마감일 인라인 편집 + 라벨 + watch 토글 + 활동).

import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { IssueTypeSelectPopover } from '../../components/issueTypes/IssueTypeSelectPopover';
import { useIssue, useUpdateIssue } from '../../hooks/queries/useIssue';
import { useDeleteIssue } from '../../hooks/queries/useIssues';
import { useProjectMembers } from '../../hooks/queries/useProjectMembers';
import { useProject } from '../../hooks/queries/useProjects';
import { useWatchers, useWatchToggle } from '../../hooks/queries/useWatchToggle';
import { useAuth } from '../../hooks/useAuth';
import { handleApiError } from '../../lib/api-error';
import type { UpdateIssueRequest } from '../../types/issue';
import { IssueChatPanel } from './components/chat/IssueChatPanel';
import { IssueAttachmentStrip } from './components/IssueAttachmentStrip';
import { IssueBodyTabs } from './components/IssueBodyTabs';
import { IssueChildrenSection } from './components/IssueChildrenSection';
import { IssuePropertyRail } from './components/IssuePropertyRail';

// 제목 인라인 편집 — 표시 모드(텍스트+연필)와 편집 모드(input) 토글.
// 무엇을: 헤더 제목을 클릭/연필로 input 으로 전환, Enter·blur 저장, Escape 취소.
// 왜: 오타·제목 수정을 위해 이슈를 삭제·재생성해야 하는 불편 해소 (#117).
function InlineEditableTitle({
  title,
  onSave,
  disabled,
}: {
  title: string;
  onSave: (next: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  // 무엇을: Escape 직후 발생하는 blur 가 저장을 트리거하지 않도록 1회 스킵 플래그.
  // 왜: setDraft 는 비동기라 blur 핸들러가 stale 값을 보므로, ref 로 결정적으로 취소를 처리.
  const skipCommitRef = useRef(false);

  // 무엇을: 편집 진입 — 현재 값으로 draft 시드.
  const enter = () => {
    setDraft(title);
    setEditing(true);
  };

  // 무엇을: 단일 저장 경로(blur). Enter 는 blur() 를 호출해 이 경로로 합류.
  // 빈/공백 제목 가드: trim 후 비었거나 변화 없으면 PATCH 없이 표시만 원복.
  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      setEditing(false);
      return;
    }
    const trimmed = draft.trim();
    setEditing(false);
    // 왜: zod min(1) 위반(빈 제목)·불변 요청은 무의미하므로 UI 에서 차단.
    if (!trimmed || trimmed === title) return;
    onSave(trimmed);
  };

  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate">{title}</span>
        <button
          type="button"
          onClick={enter}
          disabled={disabled}
          aria-label="제목 편집"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }

  return (
    <Input
      autoFocus
      data-testid="issue-title-input"
      className="h-8 max-w-md"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          skipCommitRef.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// 본문 인라인 편집 — 표시(prose)와 편집(textarea) 토글.
// 무엇을: 본문 영역을 연필로 textarea 로 전환, blur·Cmd/Ctrl+Enter 저장, Escape 취소.
// 빈 본문은 허용(스키마는 max 길이만 제약). 변화 없으면 PATCH 생략.
function InlineEditableBody({
  body,
  onSave,
  disabled,
}: {
  body: string | null;
  onSave: (next: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body ?? '');
  // Escape 취소 시 후속 blur 저장을 막는 1회 스킵 플래그 (제목과 동일 패턴).
  const skipCommitRef = useRef(false);

  const enter = () => {
    setDraft(body ?? '');
    setEditing(true);
  };

  // 단일 저장 경로(blur). Cmd/Ctrl+Enter 는 blur() 로 합류.
  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      setEditing(false);
      return;
    }
    setEditing(false);
    // 왜: 본문은 빈 값 허용. 단 변화 없으면 무의미 요청 차단.
    if (draft === (body ?? '')) return;
    onSave(draft);
  };

  if (!editing) {
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={enter}
          disabled={disabled}
          aria-label="본문 편집"
          className="absolute right-0 top-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <article className="prose dark:prose-invert max-w-none whitespace-pre-wrap">
          {body ?? <em className="text-muted-foreground">본문 없음</em>}
        </article>
      </div>
    );
  }

  return (
    <Textarea
      autoFocus
      data-testid="issue-body-textarea"
      className="min-h-[160px]"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          skipCommitRef.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

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
      toast.success('이슈 필드가 업데이트되었습니다');
    } catch (e) {
      handleApiError(e, '변경에 실패했습니다');
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={
          <InlineEditableTitle
            title={summary.title}
            onSave={(t) => patch({ title: t })}
            disabled={update.isPending}
          />
        }
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
        {/* 3구역 flex: [메인 본문][채팅 패널][속성 레일] — lg 이상에서 가로 배치 (#343 Task 4). */}
        <div className="container mx-auto flex flex-col gap-6 p-6 lg:flex-row">
          {/* 메인 본문 */}
          <div className="min-w-0 flex-1 space-y-4">
            <InlineEditableBody
              body={body}
              onSave={(b) => patch({ body: b })}
              disabled={update.isPending}
            />
            {/* 본문 설명 바로 아래 — 첨부 가로 칩 스트립 (#343 Task 2). */}
            <IssueAttachmentStrip
              projectKey={key}
              number={issueNumber}
              attachmentCount={summary.attachmentCount}
              currentUserId={user?.id ?? null}
              isOwner={isOwner}
            />
            {/* 비SUBTASK 상세 본문 아래 — 자식 SUBTASK 진행률/목록/인라인 추가 (Phase 4a). */}
            {!isSubtask && (
              <IssueChildrenSection
                projectKey={key}
                parentNumber={issueNumber}
                childCount={summary.childCount}
                childDoneCount={summary.childDoneCount}
              />
            )}
            <IssueBodyTabs
              projectKey={key}
              issueNumber={issueNumber}
              issueId={summary.id}
              comments={comments}
              history={history}
            />
          </div>
          {/* 채팅 패널 — 접힘/펼침 자동 토글. lg 이상에서 본문과 레일 사이. */}
          <IssueChatPanel projectKey={key} issueNumber={issueNumber} />
          {/* 속성 레일 — data-testid 은 IssuePropertyRail 내부에 있음. */}
          <aside className="w-full shrink-0 lg:w-[280px]">
            <IssuePropertyRail
              projectKey={key}
              issueNumber={issueNumber}
              isSubtask={isSubtask}
              parent={summary.parent}
              status={summary.status}
              priority={summary.priority}
              dueDate={summary.dueDate}
              assignees={summary.assignees}
              labels={summary.labels}
              blockedBy={summary.blockedBy}
              blocks={summary.blocks}
              customFields={summary.customFields}
              updatePending={update.isPending}
              onPatch={patch}
            />
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
