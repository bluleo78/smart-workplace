// 이슈 상세 — 본문 + 코멘트 + 우측 사이드바(상태/우선순위/마감일 인라인 편집 + 라벨 + watch 토글 + 활동).

import { Eye, EyeOff, FileQuestion, MoreHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext';
import { Page, pageGutterClass } from '@/components/layout/Page';
import { ResourceErrorState } from '@/components/layout/ResourceErrorState';
import { type EditBarControls, MobileEditBar } from '@/components/mobile/MobileEditBar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/overlay/dropdown-menu';
import { CopyLinkButton } from '@/components/share/CopyLinkButton';
import { LinkMenuItems } from '@/components/share/LinkMenuItems';
import { ShareSheetButton } from '@/components/share/ShareSheetButton';
import { useRegisterShareTarget } from '@/components/share/useRegisterShareTarget';
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
import { Separator } from '@/components/ui/separator';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { appUrl, issuePath } from '@/lib/appUrl';
import { hasIssueChatParam, ISSUE_CHAT_OPEN, ISSUE_CHAT_PARAM } from '@/lib/issueChatParam';
import { commentIdFromHash } from '@/lib/issueCommentLink';
import type { ShareTarget } from '@/lib/shareTarget';
import { cn } from '@/lib/utils';

import { AgentWorkCard } from '../../components/issue/agentWork/AgentWorkCard';
import { InlineEditableBody } from '../../components/issue/InlineEditableBody';
import { IssueInstantContextCard } from '../../components/issue/IssueInstantContextCard';
import { IssueTypeSelectPopover } from '../../components/issueTypes/IssueTypeSelectPopover';
import { MobileSheetShell } from '../../components/mobile/MobileSheetShell';
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
import { useIsMobile } from '../../hooks/useIsMobile';
import { useReturnOnEscape, useReturnToIssueOrigin } from '../../hooks/useIssueOrigin';
import { aiClassifyApplyToast } from '../../lib/aiClassifyResult';
import { buildIssueDetailContext } from '../../lib/aiScreenContext/builders/issue';
import { isNotFoundError } from '../../lib/api-error';
import { issueDeleteChildrenWarning, issueDeleteEntityName } from '../../lib/issueDeleteText';
import { isProjectOwner, workflowLockedNotice } from '../../lib/projectPermissions';
import { eulReul } from '../../lib/utils';
import type { UpdateIssueRequest } from '../../types/issue';
import { IssueChatButton } from './components/chat/IssueChatButton';
import { IssueChatDrawer } from './components/chat/IssueChatDrawer';
import { useIssueChatDrawerParam } from './components/chat/useIssueChatDrawerParam';
import { InlineEditableTitle } from './components/InlineEditableTitle';
import { IssueAttachmentStrip } from './components/IssueAttachmentStrip';
import { IssueBodyTabs } from './components/IssueBodyTabs';
import { IssueBreadcrumbHeader } from './components/IssueBreadcrumbHeader';
import { IssueChildrenSection } from './components/IssueChildrenSection';
import { IssueCommentComposer } from './components/IssueCommentComposer';
import { IssuePropertyRail } from './components/IssuePropertyRail';
import { IssueReporterField } from './components/IssueReporterField';
import { IssueMobilePropertyChips } from './components/mobile/IssueMobilePropertyChips';
import { WorkflowLockedHint } from './components/WorkflowLockedHint';
import { useVersionedPatch } from './hooks/useVersionedPatch';

// 이슈 상세 페이지 — URL 파라미터에서 프로젝트 키와 이슈 번호를 받아 단건 조회.
export default function IssueDetailPage() {
  const { key = '', number = '' } = useParams();
  const issueNumber = Number(number);
  const navigate = useNavigate();
  // 개인 프로젝트 여부 판별 — 개인 프로젝트의 이슈는 풀페이지 대신 패널로 귀결시킨다.
  const project = useProject(key);
  const issueQuery = useIssue(key, issueNumber);
  const { data, isLoading, error, refetch } = issueQuery;
  // 탭 제목 — 「{키-번호} {제목}」(WP-814). 불러오기 전에는 주소 기본값(작업 관리).
  useDocumentTitle([data && `${data.summary.projectKey}-${data.summary.number} ${data.summary.title}`]);
  const update = useUpdateIssue(key, issueNumber);
  // #611 제목·본문은 편집을 시작한 순간의 version 을 저장 기준으로 고정한다 — 편집하는 사이 코멘트 SSE·창 포커스 리페치로 캐시 version 이
  // 올라가도, 그 사이 다른 사람이 바꾼 내용을 모른 채 덮어쓰지 않고 409 로 알 수 있게(개인 작업 메모와 같은 공용 훅).
  const versioned = useVersionedPatch<'title' | 'body'>(update, data?.summary.version);
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
  // 모바일 ⋯ 메뉴 항목 문구 — 메뉴 안에선 동작("구독하기")·상태("구독 중 · n명")를 글자로 풀어 쓴다(U3-R6). 데스크톱은 기존 버튼 그대로.
  const isMobile = useIsMobile();
  // 모바일 하단 작성창으로 방금 쓴 코멘트 id — 활동 목록이 그 코멘트까지 스크롤한 뒤 비운다(WP-1016).
  const [postedCommentId, setPostedCommentId] = useState<number | null>(null);
  // 코멘트 링크(#comment-<id>)로 들어온 코멘트(WP-1175) — 해시 값마다 한 번만 그리로 스크롤한다.
  // 처리한 해시를 기억해, 코멘트를 달거나 채팅 드로워·첨부 미리보기를 열고 닫아도(useHistoryParam 이 해시를 그대로 둔 채 이동한다)
  // 되돌아가지 않게 한다. 해시가 사라지거나 다른 코멘트로 바뀌면 다시 처리한다.
  // 상세를 마운트 뒤 아직 다시 받지 않았으면(캐시가 오래됨) 기다린다 — 옛 목록에는 그 사이 달린 코멘트가 없어 「찾을 수 없음」으로
  // 잘못 끝난다. isFetching 대신 한 번만 바뀌는 값을 읽는다(읽은 값이 바뀔 때마다 react-query 가 화면 전체를 다시 그린다).
  const location = useLocation();
  const [handledHash, setHandledHash] = useState<string | null>(null);
  if (!location.hash && handledHash !== null) setHandledHash(null);
  const linkHashId = handledHash === location.hash ? null : commentIdFromHash(location.hash);
  const linkedCommentId =
    linkHashId != null && (issueQuery.isFetchedAfterMount || !issueQuery.isStale) ? linkHashId : null;
  const onLinkedCommentHandled = useCallback(() => setHandledHash(location.hash), [location.hash]);
  // 모바일 하단 편집 바(WP-196) — 제목·본문은 동시에 편집 중일 수 있다(모바일 제목은 blur 저장이 없어 본문을 탭해도 편집 유지).
  // 그래서 편집기별 슬롯을 따로 두고, 마지막에 편집을 시작한 쪽 컨트롤을 보여주되 그쪽이 끝나면 남은 편집기로 넘어간다.
  // 한 슬롯만 쓰면 먼저 끝난 쪽의 cleanup(null)이 다른 편집기의 저장·취소 경로까지 지워버린다.
  const [titleControls, setTitleControls] = useState<EditBarControls | null>(null);
  const [bodyControls, setBodyControls] = useState<EditBarControls | null>(null);
  // 마지막 편집 진입 — onEditStart 에서만 갱신(컨트롤 재전송은 disabled 변화로도 일어나므로 기준으로 쓰지 않는다).
  const [lastEditor, setLastEditor] = useState<'title' | 'body'>('title');
  const editControls =
    lastEditor === 'title' ? (titleControls ?? bodyControls) : (bodyControls ?? titleControls);
  // 모바일 「＋ 속성」 시트 open 상태 — 칩 줄의 「＋ 속성」 버튼이 열고, 아래 MobileSheetShell(issue-more-props-sheet)이 이 값으로 열림/닫힘을 제어한다.
  const [moreOpen, setMoreOpen] = useState(false);
  // 시트 안 링크(의존성·상위 배지)로 다른 이슈로 이동하면 같은 라우트라 페이지 인스턴스가 재사용된다 — 이슈가 바뀌면 시트를 닫는다(렌더 중 상태 조정).
  const [prevIssueKey, setPrevIssueKey] = useState(`${key}/${issueNumber}`);
  if (prevIssueKey !== `${key}/${issueNumber}`) {
    setPrevIssueKey(`${key}/${issueNumber}`);
    setMoreOpen(false);
  }
  const watcherCount = watchers.data?.length ?? 0;
  const mobileWatchLabel = isWatching ? `구독 중 · ${watcherCount}명` : '구독하기';
  // 삭제 확인 다이얼로그 open 상태 — shadcn AlertDialog 제어형.
  const [deletePending, setDeletePending] = useState(false);
  // 채팅 드로워 open 상태 — URL ?chat=1 (시스템 뒤로가기가 드로워부터 닫도록, H2). 헤더 채팅 버튼으로 연다.
  // 팀 이슈 상세를 그릴 준비가 됐는지 — 이슈를 받았고, 없는 이슈가 아니며, 팀 프로젝트로 확정됐다(개인이면 패널로 리다이렉트).
  // 채팅 서랍 펴기(WP-1414)와 ESC 복귀(#885)가 같은 조건을 쓴다.
  const teamIssueReady = !!data && !isNotFoundError(error) && project.data != null && project.data.type !== 'PERSONAL';
  // 알림·링크로 서랍이 열린 채 들어오면 「이슈 → 채팅」 두 항목으로 펴서 닫기가 이슈 상세로 돌아오게 한다(WP-1414).
  // 준비된 뒤에만 편다 — 개인 프로젝트는 아래 리다이렉트(WP-1372)가 chat 을 넘겨받아야 하고,
  // 로딩·없는 이슈 화면엔 서랍이 없어 항목만 늘어난다.
  const { open: chatOpen, openChat, closeChat } = useIssueChatDrawerParam({
    unmarkedEntry: 'expand',
    unmarkedEntryReady: teamIssueReady,
  });
  // 첨부 삭제 권한 UI 토글용 — 첨부자 또는 OWNER. 백엔드 가드가 최종 검증.
  const members = useProjectMembers(key);
  const isOwner = isProjectOwner(members.data, user?.id);

  // WP-54: AI 채팅 화면 컨텍스트 — 이 이슈를 "보고 있는 대상"으로 등록(데이터 로딩 전엔 미등록).
  // Rules of Hooks: 아래 조기 반환 이전에 호출한다. 개인 프로젝트 리다이렉트 경로에선 곧 언마운트되어 해제된다.
  const screenContext = useMemo(
    () => (data ? buildIssueDetailContext({ projectKey: key, issue: data.summary }) : null),
    [data, key],
  );
  useRegisterAiScreenContext(screenContext);

  // WP-1234 지금 보는 대상 — 🔗·⬆︎·⇧⌘,·⌘. 가 이 이슈의 링크·키를 쓴다. 로딩 전·개인 프로젝트(곧 패널로 옮겨 감)는 등록하지 않는다.
  const issueTitle = data?.summary.title;
  const shareTarget = useMemo<ShareTarget | null>(
    () =>
      issueTitle != null && project.data != null && project.data.type !== 'PERSONAL'
        ? { kind: 'issue', url: appUrl(issuePath(key, issueNumber)), title: issueTitle, key: `${key}-${issueNumber}` }
        : null,
    [issueTitle, project.data, key, issueNumber],
  );
  useRegisterShareTarget(shareTarget);

  // #885 이전 화면으로 돌아가기 — 헤더 ← 버튼과 ESC 가 같은 복귀 동작을 쓴다.
  // 로딩·오류·개인 프로젝트 리다이렉트 중에는 헤더가 없으므로 ESC 도 걸지 않는다.
  // AI 패널이 열려 있으면 ESC 는 패널을 닫는 데 쓰이므로(AIChip) 그동안은 양보한다.
  const returnToOrigin = useReturnToIssueOrigin(key);
  const { mode: aiMode } = useAssistant();
  const canReturn = teamIssueReady && aiMode === 'closed';
  useReturnOnEscape(returnToOrigin, canReturn);

  // 프로젝트 타입이 확정되기 전에는 렌더 보류 — 팀 화면 반짝임 방지.
  if (project.isLoading) return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error)
    return (
      <ResourceErrorState
        icon={FileQuestion}
        title="프로젝트를 불러올 수 없습니다"
        titleAs="h1"
        description="요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다."
        actionLabel="프로젝트 목록으로"
        onAction={() => navigate('/projects')}
      />
    );
  // 개인 프로젝트의 이슈 풀페이지 진입(알림/북마크)은 프로젝트 화면의 우측 패널로 리다이렉트한다.
  // 팀 프로젝트는 기존 풀페이지 유지.
  // 채팅 딥링크(`?chat=1` — 이슈챗 알림·「내 AI 작업」 채팅 링크)는 이어 붙여 개인 작업 상세가 채팅 칸으로 이동하게 한다(WP-1372).
  // 다른 쿼리는 지금처럼 버린다.
  if (project.data?.type === 'PERSONAL') {
    const params = new URLSearchParams({ task: String(issueNumber) });
    if (hasIssueChatParam(location.search)) params.set(ISSUE_CHAT_PARAM, ISSUE_CHAT_OPEN);
    return <Navigate to={`/projects/${key}?${params}`} replace />;
  }

  if (isLoading) return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  // 원격 삭제(resource.changed deleted) 후 재조회가 404 면 TanStack Query 가 마지막 data 를 남기므로,
  // data 유무보다 먼저 404 를 확인해 stale 이슈(편집 컨트롤 포함) 대신 not-found 상태를 보여준다.
  // 주소의 번호가 1 이상의 정수가 아니면(/issues/abc) 조회 자체를 하지 않으므로 같은 not-found 로 보인다(WP-925) —
  // 아래의 「다시 시도」 안내는 다시 해도 소용이 없다.
  if (isNotFoundError(error) || !(Number.isInteger(issueNumber) && issueNumber > 0))
    return (
      <ResourceErrorState
        icon={FileQuestion}
        title="이슈를 찾을 수 없습니다"
        description="이슈가 삭제되었거나 접근 권한이 없습니다."
        actionLabel="프로젝트로 돌아가기"
        onAction={() => navigate(`/projects/${key}`)}
      />
    );
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
  // 보고자 바꾸기(WP-944) — 서버 플래그가 참일 때만 레일·모바일 시트의 보고자 필드가 고르기 트리거가 된다.
  const reporterEdit = data.viewerCanChangeReporter
    ? { projectKey: key, issueNumber: issueNumber, currentUserId: user?.id, isOpenProject: project.data?.type === 'OPEN' }
    : undefined;
  // 워크플로 필드가 권한으로 막혔을 때 안내(WP-503) — 제목 아래 속성 줄 끝엔 짧은 표시(누르면 문구), 모바일 「속성」 시트 맨 위엔 문구 한 줄.
  const lockedNotice = workflowLockedNotice(canEditWorkflow, canEditContent);

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
  // 성공 여부를 돌려준다 — 제목·본문 편집기가 실패 시 입력을 버리지 않고 편집을 다시 열 때 쓴다(#611).
  // 편집 기준 version 올리기(내 저장)·풀기(409)는 useVersionedPatch 가 맡는다(#611). 실패 토스트(409 충돌 안내 포함)는 useUpdateIssue 가 띄운다.
  const patch = async (changes: UpdateIssueRequest, options?: { silent?: boolean }): Promise<boolean> => {
    const ok = await versioned.patch(changes);
    if (ok && !options?.silent) toast.success('이슈 필드가 업데이트되었습니다');
    return ok;
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
          tasks.push(patch({ priority: result.priority }, { silent: true }));
          // 유형 제안 — 이름→ID 매핑 후 별도 엔드포인트로 적용.
          // 왜: IssueTypeSelectPopover 에서 유형 변경 시 updateType.mutate({ typeId }) 패턴과 동일.
          if (result.type && allIssueTypes.data) {
            const suggestedType = allIssueTypes.data.find((t) => t.name === result.type);
            if (suggestedType) {
              tasks.push(updateType.mutateAsync({ typeId: suggestedType.id }));
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
          // 여기서는 완료 대기만 하고(allSettled) 성공 토스트 1개만 통합 노출한다 — 하나도 적용되지 않았으면 띄우지 않는다(WP-503).
          const message = aiClassifyApplyToast(await Promise.allSettled(tasks));
          if (message === null) return;
          toast.success(message);
          setClassifyReason(result.reason);
        },
        onError: () => toast.error('AI 제안을 받지 못했습니다'),
      },
    );
  };

  // 채팅 드로워 토글 — actions(우측 고정) 슬롯. meta/icon 슬롯은 제목 길이에 따라
  // 위치가 흔들려 글로벌 AI 런처(fixed top-center)와 겹쳤던 회귀(#558) 이력이 있다.
  const chatButton = (
    <IssueChatButton
      projectKey={key}
      issueNumber={issueNumber}
      open={chatOpen}
      onOpen={openChat}
      variant={isMobile ? 'icon' : 'default'}
    />
  );
  // 구독·삭제 — 데스크톱은 채팅 옆 버튼, 모바일은 ⋯ 메뉴 항목.
  const secondaryActions = (
    <>
      <Button
        variant="outline"
        size="sm"
        // 요청 중엔 disabled 대신 aria-disabled + 누름 무시 — disabled 로 꺼지면 키보드 초점이 body 로 사라진다(WP-847).
        onClick={() => { if (!toggleWatch.isPending) toggleWatch.mutate(!isWatching) }}
        aria-pressed={isWatching}
        aria-label={isMobile ? mobileWatchLabel : isWatching ? '구독 중' : '구독'}
        data-testid="watch-toggle"
        aria-disabled={toggleWatch.isPending || undefined}
        aria-busy={toggleWatch.isPending || undefined}
        className={cn(toggleWatch.isPending && 'cursor-progress opacity-50')}
      >
        {isWatching ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
        {isMobile ? (
          mobileWatchLabel
        ) : (
          <>
            {isWatching ? '구독 중' : '구독'}
            <span className="ml-1 text-xs text-muted-foreground">
              {watchers.data?.length ?? 0}
            </span>
          </>
        )}
      </Button>
      {canDelete && (
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          aria-label="태스크 삭제"
          data-testid="issue-delete"
          disabled={remove.isPending}
          // 모바일 ⋯ 메뉴에선 파괴적 항목을 빨간 글자로(메뉴가 text-destructive 색을 유지한다, U3-R6).
          className={isMobile ? 'text-destructive' : undefined}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          삭제
        </Button>
      )}
    </>
  );

  // 속성 레일 — 데스크톱 aside(variant=rail)와 모바일 ＋ 속성 시트(variant=sheet)가 같은 컴포넌트를 공유한다.
  const renderRail = (variant: 'rail' | 'sheet') => (
            <IssuePropertyRail
              projectKey={key}
              issueNumber={issueNumber}
              isSubtask={isSubtask}
              isEpic={isEpic}
              epicColor={summary.epicColor}
              epicFallbackColor={summary.type?.colorToken}
              parent={summary.parent}
              status={summary.status}
              statusId={summary.statusId}
              statusName={summary.statusName}
              priority={summary.priority}
              dueDate={summary.dueDate}
              startDate={summary.startDate}
              milestoneId={summary.milestoneId}
              assignees={summary.assignees}
              reporter={data.reporter}
              reporterEdit={reporterEdit}
              createdAt={summary.createdAt}
              closedAt={summary.closedAt}
              labels={summary.labels}
              components={summary.components ?? []}
              fixVersions={summary.fixVersions ?? []}
              affectsVersions={summary.affectsVersions ?? []}
              blockedBy={summary.blockedBy}
              blocks={summary.blocks}
              relations={data.relations ?? []}
              externalLinks={data.externalLinks ?? []}
              customFields={summary.customFields}
              updatePending={update.isPending}
              onPatch={patch}
              canEditWorkflow={canEditWorkflow}
              onAiClassify={handleClassify}
              isAiClassifying={classify.isPending}
              aiClassifyReason={classifyReason}
              variant={variant}
            />
  );

  return (
    <Page>
      <IssueBreadcrumbHeader
        projectKey={key}
        projectName={project.data?.name ?? ''}
        parent={summary.parent}
        number={summary.number}
        type={summary.type}
        onBack={returnToOrigin}
        // 모바일: 채팅은 ⋯ 밖 아이콘(M5), ⋯ 에는 구독·삭제만. 데스크톱은 actions 한 줄 그대로.
        mobilePrimaryAction={chatButton}
        // WP-1234 모바일 ⬆︎ — 채팅 앞. 링크 항목은 ⋯ 가 아니라 이 시트에 모은다.
        mobileShare={shareTarget && <ShareSheetButton target={shareTarget} />}
        mobileActions={secondaryActions}
        actions={
          <>
            {/* WP-1234 데스크톱 🔗(바로 복사) + ⋯(키 복사·브라우저에서 열기) — 다른 액션 앞. */}
            {shareTarget && (
              <>
                <CopyLinkButton target={shareTarget} />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="이슈 메뉴" data-testid="issue-link-menu">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <LinkMenuItems target={shareTarget} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {chatButton}
            {secondaryActions}
          </>
        }
      />
      {/* #354: @container 로 "행이 들어갈 실제 너비"를 기준 삼아 3분할↔세로스택을 전환한다(아래 @min-[1032px]).
          뷰포트 기준 lg 는 AI 사이드패널이 main 을 좁혀도 3분할을 유지해, 좁아진 영역에서 본문이 붕괴되고
          채팅·레일이 AI 패널 뒤로 밀려 가려졌다(오버레이 증상). */}
      {/* padded=false — @container 쿼리 기준이 이 스크롤 div 여야 하므로 스크롤·여백은 화면이 소유한다.
          데스크톱 여백은 헤더와 같은 pageGutterClass 축(← 버튼과 제목 시작선 일치), 모바일 p-4 는 그대로. */}
      <Page.Body padded={false}>
        <div className="@container min-w-0 flex-1 overflow-y-auto">
          {/* 3구역 flex: [메인 본문][채팅 패널][속성 레일] — 컨테이너 폭 1032px(본문360+채팅320+레일280+gap/padding) 이상에서 가로 배치 (#343 Task 4, #354). */}
          <div className={cn('w-full flex flex-col', isMobile ? 'gap-4 p-4' : cn('gap-6 py-4', pageGutterClass), '@min-[1032px]:flex-row')}>
            {/* 메인 본문 — #355: 가로 배치(@1032px↑)에서만 채팅/레일 고정폭에 밀려 360px 이하로 압축되지 않도록 min-w 적용.
                세로 스택(컨테이너 좁음)에서는 본문이 어차피 full-width 라 min-w 가 narrow 컨테이너에서 오버플로우를 유발하므로 미적용 (#354). */}
            {/* 메인 컬럼 — 섹션(설명·하위 태스크·코멘트)을 Separator 바로 명확히 구분. space-y-6 으로 바 주변 여백 확보. */}
            <div className="flex-1 space-y-6 @min-[1032px]:min-w-[360px]">
              {/* 제목 + 유형/차단 배지 — 헤더는 브레드크럼만 담당하므로 본문 상단으로 이동(Jira 패턴). */}
              <div className="space-y-2" data-testid="issue-title-heading">
                {/* aria-label 명시 — 없으면 자식 편집 버튼의 aria-label("제목 편집")까지
                    heading accessible name에 concatenate 되어 스크린리더가 "{제목} 제목 편집"으로
                    읽는다 (#791, WCAG 1.3.1). */}
                <h1 className="text-2xl leading-8 font-semibold tracking-tight" aria-label={summary.title}>
                  <InlineEditableTitle
                    title={summary.title}
                    onSave={(t) => patch({ title: t, version: versioned.baseVersion('title') })}
                    onEditStart={() => {
                      versioned.beginEdit('title');
                      setLastEditor('title');
                    }}
                    disabled={!canEditContent || update.isPending}
                    commitOnBlur={!isMobile}
                    wrap
                    onEditingChange={isMobile ? setTitleControls : undefined}
                  />
                </h1>
                {isMobile ? (
                  <IssueMobilePropertyChips
                    projectKey={key}
                    issue={summary}
                    canEditWorkflow={canEditWorkflow}
                    updatePending={update.isPending}
                    onPatch={(c) => void patch(c)}
                    onOpenMore={() => setMoreOpen(true)}
                    trailing={lockedNotice && <WorkflowLockedHint message={lockedNotice} variant="chip" />}
                  />
                ) : (
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
                    {lockedNotice && <WorkflowLockedHint message={lockedNotice} variant="inline" />}
                  </div>
                )}
              </div>
              {/* AI 진행(WP-1079) — 제목 아래·AI 현황 요약 위. 진행 중 작업이 없으면 스스로 숨고, 비서 가용성과 무관(작업은 구성원이 보고했다).
                  답변 필요 배지가 이슈 채팅을 연다(옛 질문 카드 대체). 모바일은 좁은 폭에 맞춰 작업자마다 여러 줄로 쌓는다. */}
              <AgentWorkCard list={summary.agentWork} onOpenChat={openChat} stacked={isMobile} />
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
                  onSave={(b) => patch({ body: b, version: versioned.baseVersion('body') })}
                  onEditStart={() => {
                    versioned.beginEdit('body');
                    setLastEditor('body');
                  }}
                  disabled={!canEditContent || update.isPending}
                  projectKey={key}
                  issueNumber={issueNumber}
                  hideActions={isMobile}
                  mobile={isMobile}
                  onEditingChange={isMobile ? setBodyControls : undefined}
                />
                {/* 본문 설명 바로 아래 — 첨부 가로 칩 스트립 (#343 Task 2). */}
                <IssueAttachmentStrip
                  projectKey={key}
                  number={issueNumber}
                  attachmentCount={summary.attachmentCount}
                  currentUserId={user?.id ?? null}
                  isOwner={isOwner}
                  canEditContent={canEditContent}
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
                    parentStatus={summary.status}
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
                canReact={canEditContent}
                hideComposer={isMobile}
                scrollToCommentId={postedCommentId}
                onScrolledToComment={() => setPostedCommentId(null)}
                linkedCommentId={linkedCommentId}
                onLinkedCommentHandled={onLinkedCommentHandled}
              />
            </div>
            {/* 채팅은 헤더 버튼 → 드로워(IssueChatDrawer)로 분리(구 인라인 패널 제거). */}
            {/* 속성 레일 — data-testid 은 IssuePropertyRail 내부에 있음. #354: 뷰포트 lg → 컨테이너 1032px 기준. */}
            {!isMobile && (
              <aside className="w-full shrink-0 @min-[1032px]:w-[280px]">{renderRail('rail')}</aside>
            )}
          </div>
        </div>
      </Page.Body>
      {/* 모바일 하단 줄(WP-196) — 스크롤 영역 아래 in-flow. MobileShell 이 --vvh 로 줄어 키보드 바로 위에 붙고(R1),
          bottom safe-area 는 셸 <main> 이 준다. 제목·본문 편집 중엔 코멘트 입력 대신 [취소·저장] 바. */}
      {isMobile && (
        <div className="shrink-0 border-t bg-background px-4 py-2" data-testid="mobile-bottom-bar">
          {editControls && <MobileEditBar controls={editControls} />}
          {/* 편집 바가 떠 있는 동안에도 작성창은 언마운트하지 않고 숨긴다 — 쓰던 코멘트 초안·이탈 경고 상태 보존. */}
          <div hidden={editControls != null}>
            <IssueCommentComposer
              projectKey={key}
              issueNumber={issueNumber}
              issueId={summary.id}
              // 정확히 4줄 — lh 단위는 에디터 자신의 줄 높이(터치 16px 글꼴 기준)라 4lh + py-2(1rem) + 테두리 2px = 4줄 + 여백.
              editorMaxHeightClass="max-h-[calc(4lh+1rem+2px)]"
              inlineSubmit
              onPosted={setPostedCommentId}
            />
          </div>
        </div>
      )}
      {/* 모바일 「＋ 속성」 시트(WP-196) — 칩에 없는 유형·일정·분류·의존성·커스텀 필드. 데스크톱 레일과 같은 컴포넌트(variant=sheet). */}
      {isMobile && (
        <MobileSheetShell
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          title="속성"
          description="이슈의 나머지 속성을 편집합니다."
          testId="issue-more-props-sheet"
          className="min-h-[50dvh]"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {lockedNotice && <WorkflowLockedHint message={lockedNotice} variant="line" />}
            {/* 유형은 레일에 없고 모바일 제목 아래 유형 줄도 칩 줄로 대체됐으므로 시트 맨 위에서 편집한다. */}
            {summary.type && (
              <div className="flex items-center justify-between gap-2" data-testid="issue-more-props-type">
                <span className="text-xs font-medium text-muted-foreground">유형</span>
                <IssueTypeSelectPopover
                  projectKey={key}
                  issueNumber={issueNumber}
                  current={summary.type}
                  disabled={!canEditWorkflow}
                />
              </div>
            )}
            {/* 보고자(WP-272) — 시트는 상태·담당 그룹을 숨기므로 유형 바로 아래 같은 라벨↔값 행으로 둔다. */}
            <IssueReporterField reporter={data.reporter} createdAt={summary.createdAt} layout="sheet" edit={reporterEdit} />
            {renderRail('sheet')}
          </div>
        </MobileSheetShell>
      )}
      {/* 삭제 확인 AlertDialog — window.confirm() 대체. childCount > 0 시 자식 수 경고 포함. */}
      <AlertDialog open={deletePending} onOpenChange={setDeletePending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* 에픽은 「에픽 삭제」·「하위 이슈도 함께 삭제」로 알린다(WP-469). */}
            <AlertDialogTitle>{issueDeleteEntityName(summary.type?.name)} 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              {issueDeleteChildrenWarning(summary.type?.name, summary.childCount)
                ?? `이 ${issueDeleteEntityName(summary.type?.name)}${eulReul(issueDeleteEntityName(summary.type?.name))} 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
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
        onClose={closeChat}
      />
    </Page>
  );
}
