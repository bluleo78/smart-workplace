// 이슈 상세 — 본문 + 코멘트 + 우측 사이드바(상태/우선순위/마감일 인라인 편집 + 라벨 + watch 토글 + 활동).

import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

import { IssueInstantContextCard } from '../../components/issue/IssueInstantContextCard';
import { IssueTypeSelectPopover } from '../../components/issueTypes/IssueTypeSelectPopover';
import { useGenerateAiSummary, useIssue, useUpdateIssue } from '../../hooks/queries/useIssue';
import { useIssueAiClassify } from '../../hooks/queries/useIssueAiClassify';
import { useDeleteIssue } from '../../hooks/queries/useIssues';
import { useIssueTypes } from '../../hooks/queries/useIssueTypes';
import { useLabels } from '../../hooks/queries/useLabels';
import { useProjectMembers } from '../../hooks/queries/useProjectMembers';
import { useProject } from '../../hooks/queries/useProjects';
import { useUpdateIssueLabels } from '../../hooks/queries/useUpdateIssueLabels';
import { useUpdateIssueType } from '../../hooks/queries/useUpdateIssueType';
import { useWatchers, useWatchToggle } from '../../hooks/queries/useWatchToggle';
import { useAiAvailable } from '../../hooks/useAiAvailable';
import { useAuth } from '../../hooks/useAuth';
import { handleApiError } from '../../lib/api-error';
import type { UpdateIssueRequest } from '../../types/issue';
import { IssueChatButton } from './components/chat/IssueChatButton';
import { IssueChatDrawer } from './components/chat/IssueChatDrawer';
import { IssueAttachmentStrip } from './components/IssueAttachmentStrip';
import { IssueBodyTabs } from './components/IssueBodyTabs';
import { IssueBreadcrumbHeader } from './components/IssueBreadcrumbHeader';
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
          data-testid="issue-title-edit"
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

  // 표시 → 편집 진입. 진입 시 최신 본문으로 draft 초기화.
  const enter = () => {
    setDraft(body ?? '');
    setEditing(true);
  };
  // 저장 — 빈 값 허용, 변화 없으면 무의미 요청 차단.
  const save = () => {
    setEditing(false);
    if (draft !== (body ?? '')) onSave(draft);
  };
  // 취소 — draft 폐기, 편집 종료.
  const cancel = () => setEditing(false);

  if (!editing) {
    return (
      // Jira 식 — 본문 영역 전체가 클릭 가능. 호버 시 배경 변화로 편집 가능 신호.
      // role/aria-label/키보드(Enter·Space) 로 접근성 확보(article 은 button 자식 불가라 div+role).
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="본문 편집"
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) enter();
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            enter();
          }
        }}
        // 호버 시 편집 모드(textarea)와 동일한 border-input 테두리 + 패딩으로 "편집 필드" 미리보기.
        // 평소 border-transparent 로 두어 호버 시 레이아웃 시프트 방지.
        className="-mx-3 cursor-pointer rounded-md border border-transparent px-3 py-2 transition-colors hover:border-input hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* 뷰 모드 = 마크다운 렌더(## 제목·**볼드**·- [ ] 체크박스). 편집 모드(textarea)는 raw — 대비 확보. */}
        {body ? (
          <MarkdownMessage>{body}</MarkdownMessage>
        ) : (
          <em className="text-sm text-muted-foreground">본문 없음</em>
        )}
      </div>
    );
  }

  return (
    // -mx-3 으로 뷰 모드 박스(-mx-3 px-3)와 좌우 위치를 일치시켜 전환 시 여백 변화 제거.
    <div className="-mx-3 space-y-2">
      <Textarea
        autoFocus
        data-testid="issue-body-textarea"
        className="min-h-[160px]"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // 단축키: Cmd/Ctrl+Enter 저장 · Esc 취소. (blur 저장 없음 — 명시적 버튼 사용)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
      />
      {/* 편집 액션 — 하단 좌측 저장/취소(Jira 식). */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={disabled} data-testid="issue-body-save">
          저장
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={cancel}
          disabled={disabled}
          data-testid="issue-body-cancel"
        >
          취소
        </Button>
      </div>
    </div>
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
  // AI 현황 요약 온디맨드 생성 mutation — Rules of Hooks: 조기 반환 이전에 선언.
  const genSummary = useGenerateAiSummary(key, issueNumber);
  // AI 분류 제안 mutation — 편집 화면 속성 레일 버튼에서 사용.
  const classify = useIssueAiClassify(key);
  const [classifyReason, setClassifyReason] = useState<string | null>(null);
  // 라벨 목록 — AI 제안 라벨 이름→ID 매핑에 사용.
  const allLabels = useLabels(key);
  // 라벨 교체 mutation — AI 제안 라벨 적용 시 별도 엔드포인트로 호출.
  // silent: true — handleClassify 가 개별 토스트 대신 통합 토스트 하나로 대체 (#578).
  const updateLabels = useUpdateIssueLabels(key, issueNumber, { silent: true });
  // 이슈 유형 목록 — AI 제안 유형 이름→ID 매핑에 사용.
  const allIssueTypes = useIssueTypes(key);
  // 이슈 유형 변경 mutation — AI 제안 유형 적용 시 별도 엔드포인트로 호출.
  // silent: true — handleClassify 가 개별 토스트 대신 통합 토스트 하나로 대체 (#578).
  const updateType = useUpdateIssueType(key, issueNumber, { silent: true });
  const { user } = useAuth();
  // AI 가용성 — 비서 없으면 AI 카드 미렌더(#517 게이트).
  const aiAvailable = useAiAvailable();
  const watchers = useWatchers(key, issueNumber);
  const toggleWatch = useWatchToggle(key, issueNumber, user?.id ?? null);
  const isWatching = !!watchers.data?.some((w) => w.userId === user?.id);
  // 삭제 확인 다이얼로그 open 상태 — shadcn AlertDialog 제어형.
  const [deletePending, setDeletePending] = useState(false);
  // 채팅 드로워 open 상태 — 헤더 채팅 버튼으로 토글.
  const [chatOpen, setChatOpen] = useState(false);
  // 첨부 삭제 권한 UI 토글용 — 첨부자 또는 OWNER. 백엔드 가드가 최종 검증.
  const members = useProjectMembers(key);
  const isOwner =
    members.data?.some((m) => m.userId === user?.id && m.role === 'OWNER') ?? false;

  // 프로젝트 타입이 확정되기 전에는 렌더 보류 — 팀 화면 반짝임 방지.
  if (project.isLoading) return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error)
    return <p className="w-full p-6 text-destructive">프로젝트를 불러올 수 없습니다</p>;
  // 개인 프로젝트의 이슈 풀페이지 진입(알림/북마크)은 프로젝트 화면의 우측 패널로 리다이렉트한다.
  // 팀 프로젝트는 기존 풀페이지 유지.
  if (project.data?.type === 'PERSONAL') {
    return <Navigate to={`/projects/${key}?task=${issueNumber}`} replace />;
  }

  if (isLoading) return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  if (!data) return (
    <div className="w-full p-6 text-center">
      <p className="text-sm text-destructive mb-2">태스크를 찾을 수 없습니다</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}>다시 시도</Button>
    </div>
  );

  const { summary, body, comments, history } = data;
  // SUBTASK 여부 — 부모 슬롯(SUBTASK 만) / 자식 섹션(비SUBTASK 만) 분기에 사용 (Phase 4a).
  const isSubtask = summary.type?.name === 'SUBTASK';
  // EPIC 여부 — 부모 슬롯 숨김(EPIC 은 부모를 가질 수 없음) 분기에 사용 (EPIC 계층 확장).
  const isEpic = summary.type?.name === 'EPIC';

  // 서버 플래그 기반 UI 권한 분기 — 클라이언트에서 재파생하지 않는다.
  // 미지정(구 응답 호환)은 false 로 안전하게 처리 — 실제 API 는 항상 명시적으로 내려준다.
  const canEditContent = data.viewerCanEditContent ?? false;
  const canEditWorkflow = data.viewerCanEditWorkflow ?? false;
  const canDelete = data.viewerCanDelete ?? false;

  // 삭제 — cascade soft-delete. childCount > 0 이면 AlertDialog 경고 문구에 자식 수 포함.
  // 성공 시 프로젝트 보드로 이동. 권한(첨부자/OWNER) 검증은 백엔드가 수행.
  const onDelete = () => setDeletePending(true);
  const onDeleteConfirm = () => {
    remove.mutate(undefined, {
      onSuccess: () => navigate(`/projects/${key}`),
    });
  };

  // 인라인 편집 patch — 단일 필드 변경마다 호출되며 onSuccess invalidate 로 detail 재조회.
  // silent: true 면 성공 토스트를 억제 — AI 분류 적용(handleClassify)처럼 여러 필드 변경을
  // 하나의 통합 토스트로 묶는 호출부에서 사용 (#578).
  const patch = async (changes: UpdateIssueRequest, options?: { silent?: boolean }) => {
    try {
      await update.mutateAsync(changes);
      if (!options?.silent) toast.success('이슈 필드가 업데이트되었습니다');
    } catch (e) {
      handleApiError(e, '변경에 실패했습니다');
    }
  };

  // 편집 화면 AI 분류 핸들러 — 현재 제목·본문으로 제안 요청 후 즉시 반영.
  // 우선순위·유형·라벨 3개 mutation 이 각자 토스트를 띄우면 한 번의 클릭에 토스트가
  // 중복 스택되므로(#578), 각 mutation 은 silent 로 호출하고 모두 끝난 뒤 통합 토스트 1개만 노출한다.
  const handleClassify = () => {
    classify.mutate(
      { title: summary.title, body: body ?? '' },
      {
        onSuccess: async (result) => {
          const tasks: Promise<unknown>[] = [];
          // 우선순위 패치 적용.
          tasks.push(patch({ priority: result.priority as 'LOW' | 'MID' | 'HIGH' }, { silent: true }));
          // 유형 제안 — 이름→ID 매핑 후 별도 엔드포인트로 적용.
          // 왜: IssueTypeSelectPopover 에서 유형 변경 시 updateType.mutate(typeId) 패턴과 동일.
          if (result.type && allIssueTypes.data) {
            const suggestedType = allIssueTypes.data.find((t) => t.name === result.type);
            if (suggestedType) {
              tasks.push(updateType.mutateAsync(suggestedType.id));
            }
          }
          // 라벨 제안 — 이름→ID 매핑 후 현재 라벨에 병합하여 교체.
          if (result.labels.length > 0 && allLabels.data) {
            const currentIds = (summary.labels ?? []).map((l) => l.id);
            const suggestedIds = result.labels
              .map((name) => allLabels.data!.find((l) => l.name === name)?.id)
              .filter((id): id is number => id !== undefined);
            const merged = Array.from(new Set([...currentIds, ...suggestedIds]));
            tasks.push(updateLabels.mutateAsync(merged));
          }
          // 각 mutation 의 실패는 훅 자체 onError 가 이미 에러 토스트로 알리므로
          // 여기서는 완료 대기만 하고(allSettled) 성공 토스트 1개만 통합 노출한다.
          await Promise.allSettled(tasks);
          toast.success('AI 제안을 적용했습니다');
          setClassifyReason(result.reason);
        },
        onError: () => toast.error('AI 제안을 받지 못했습니다'),
      },
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <IssueBreadcrumbHeader
        projectKey={key}
        projectName={project.data?.name ?? ''}
        parent={summary.parent}
        number={summary.number}
        type={summary.type}
        actions={
          <>
            {/* 채팅 드로워 토글 — actions(우측 고정) 슬롯. meta/icon 슬롯은 제목 길이에 따라
                위치가 흔들려 글로벌 AI 런처(fixed top-center)와 겹쳤던 회귀(#558) 이력이 있다. */}
            <IssueChatButton
              projectKey={key}
              issueNumber={issueNumber}
              open={chatOpen}
              onOpen={() => setChatOpen(true)}
            />
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
            {canDelete && (
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
            )}
          </>
        }
      />
      {/* #354: @container 로 "행이 들어갈 실제 너비"를 기준 삼아 3분할↔세로스택을 전환한다(아래 @min-[1032px]).
          뷰포트 기준 lg 는 AI 사이드패널이 main 을 좁혀도 3분할을 유지해, 좁아진 영역에서 본문이 붕괴되고
          채팅·레일이 AI 패널 뒤로 밀려 가려졌다(오버레이 증상). */}
      <div className="@container flex-1 overflow-y-auto">
        {/* 3구역 flex: [메인 본문][채팅 패널][속성 레일] — 컨테이너 폭 1032px(본문360+채팅320+레일280+gap/padding) 이상에서 가로 배치 (#343 Task 4, #354). */}
        <div className="w-full flex flex-col gap-6 p-6 @min-[1032px]:flex-row">
          {/* 메인 본문 — #355: 가로 배치(@1032px↑)에서만 채팅/레일 고정폭에 밀려 360px 이하로 압축되지 않도록 min-w 적용.
              세로 스택(컨테이너 좁음)에서는 본문이 어차피 full-width 라 min-w 가 narrow 컨테이너에서 오버플로우를 유발하므로 미적용 (#354). */}
          {/* 메인 컬럼 — 섹션(설명·하위 태스크·코멘트)을 Separator 바로 명확히 구분. space-y-6 으로 바 주변 여백 확보. */}
          <div className="flex-1 space-y-6 @min-[1032px]:min-w-[360px]">
            {/* 제목 + 유형/차단 배지 — 헤더는 브레드크럼만 담당하므로 본문 상단으로 이동(Jira 패턴). */}
            <div className="space-y-2" data-testid="issue-title-heading">
              <h1 className="text-2xl leading-8 font-semibold tracking-tight">
                <InlineEditableTitle
                  title={summary.title}
                  onSave={(t) => patch({ title: t })}
                  disabled={!canEditContent || update.isPending}
                />
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                {summary.type && (
                  <IssueTypeSelectPopover
                    projectKey={key}
                    issueNumber={issueNumber}
                    current={summary.type}
                    disabled={!canEditWorkflow}
                  />
                )}
                {/* Phase 4b — blockedBy 중 미완료 존재 시 차단됨 배지 노출. */}
                {summary.blocked && (
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-destructive/15 text-destructive text-xs"
                    data-testid="issue-blocked-badge"
                  >
                    ⛔ 차단됨
                  </span>
                )}
              </div>
            </div>
            {/* AI 즉각 컨텍스트 카드 — 비서 있을 때만 렌더(#517). 자체 아우라 박스라 바 없이 분리. */}
            {aiAvailable && (
              <IssueInstantContextCard
                aiContext={data.aiContext}
                onGenerate={() => genSummary.mutate()}
                isGenerating={genSummary.isPending}
              />
            )}
            {/* 본문 섹션 — 본문 + 첨부. 섹션 레이블 "본문" = 디자인 시스템 heading-group(H4) 토큰. */}
            <section aria-label="본문" className="space-y-2">
              <h2 className="text-base leading-6 font-medium">본문</h2>
              <InlineEditableBody
                body={body}
                onSave={(b) => patch({ body: b })}
                disabled={!canEditContent || update.isPending}
              />
              {/* 본문 설명 바로 아래 — 첨부 가로 칩 스트립 (#343 Task 2). */}
              <IssueAttachmentStrip
                projectKey={key}
                number={issueNumber}
                attachmentCount={summary.attachmentCount}
                currentUserId={user?.id ?? null}
                isOwner={isOwner}
              />
            </section>

            {/* 설명 ↔ 다음 섹션 구분 바 */}
            <Separator />

            {/* 하위 태스크 — 비SUBTASK 만(#343 Phase 4a). 뒤에 구분 바를 함께 묶어 subtask 일 때 dangling 바 방지. */}
            {!isSubtask && (
              <>
                <IssueChildrenSection
                  projectKey={key}
                  parentNumber={issueNumber}
                  parentTypeName={summary.type?.name ?? ''}
                  childCount={summary.childCount}
                  childDoneCount={summary.childDoneCount}
                />
                <Separator />
              </>
            )}

            {/* 코멘트 / 활동 */}
            <IssueBodyTabs
              projectKey={key}
              issueNumber={issueNumber}
              issueId={summary.id}
              comments={comments}
              history={history}
            />
          </div>
          {/* 채팅은 헤더 버튼 → 드로워(IssueChatDrawer)로 분리(구 인라인 패널 제거). */}
          {/* 속성 레일 — data-testid 은 IssuePropertyRail 내부에 있음. #354: 뷰포트 lg → 컨테이너 1032px 기준. */}
          <aside className="w-full shrink-0 @min-[1032px]:w-[280px]">
            <IssuePropertyRail
              projectKey={key}
              issueNumber={issueNumber}
              isSubtask={isSubtask}
              isEpic={isEpic}
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
              canEditWorkflow={canEditWorkflow}
              onAiClassify={handleClassify}
              isAiClassifying={classify.isPending}
              aiClassifyReason={classifyReason}
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
      {/* 채팅 드로워 — 헤더 채팅 버튼으로 토글. */}
      <IssueChatDrawer
        projectKey={key}
        issueNumber={issueNumber}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
