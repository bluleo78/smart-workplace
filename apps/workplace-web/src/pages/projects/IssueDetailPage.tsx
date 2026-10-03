// 이슈 상세 — 본문 + 코멘트 + 우측 사이드바(상태/우선순위/마감일 인라인 편집 + 라벨 + watch 토글 + 활동).

import { isAxiosError } from 'axios';
import { Eye, EyeOff, FileQuestion, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext';
import { ResourceErrorState } from '@/components/layout/ResourceErrorState';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { IssueBodyImage } from '../../components/issue/IssueBodyImage';
import { IssueBodyImageButton } from '../../components/issue/IssueBodyImageButton';
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
import { useIssueImageUpload } from '../../hooks/useIssueImageUpload';
import { useReturnOnEscape, useReturnToIssueOrigin } from '../../hooks/useIssueOrigin';
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning';
import { buildIssueDetailContext } from '../../lib/aiScreenContext/builders/issue';
import { isNotFoundError } from '../../lib/api-error';
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
import { IssueMobilePropertyChips } from './components/mobile/IssueMobilePropertyChips';
import { type EditBarControls, MobileEditBar } from './components/mobile/MobileEditBar';

// 본문 편집 draft localStorage 키 — 프로젝트+이슈 단위로 특정(#824).
function bodyDraftKey(projectKey: string, issueNumber: number): string {
  return `issue-body-draft:${projectKey}:${issueNumber}`;
}

// localStorage 접근은 프라이빗 모드·사이트 데이터 차단 환경에서 throw 할 수 있으므로
// 전부 try/catch — 실패해도 편집 자체는 정상 동작해야 한다(#824).
function readBodyDraft(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeBodyDraft(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 무시 — 초안 저장은 보완책일 뿐 필수 기능이 아니다.
  }
}
function clearBodyDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 무시.
  }
}

/**
 * 보기 모드 본문("클릭=편집 진입" 래퍼)에서 받은 이벤트가 본문 안 상호작용 요소에서 온 것인지(WP-199).
 * 링크·버튼·이미지(클릭 시 미리보기)는 각자 동작해야 하므로 편집 진입을 하지 않는다.
 * 미리보기 모달은 포털이라 DOM 상 래퍼 밖이지만 React 합성 이벤트는 래퍼까지 전파된다 —
 * 대상이 래퍼 DOM 밖(포털: 모달 본문·오버레이·닫기 버튼)이면 역시 무시한다. 자식마다 전파를 끊는 대신 경계를 한 곳에서 판정한다.
 */
function isFromInteractiveDescendant(e: React.SyntheticEvent<HTMLElement>): boolean {
  const target = e.target as Element;
  if (!e.currentTarget.contains(target)) return true;
  // 래퍼 바깥 조상(페이지 레이아웃의 링크 등)이 걸리지 않게 래퍼 안에서 찾은 요소만 본다.
  const hit = target.closest('a,button,img,[role="dialog"]');
  return hit !== null && e.currentTarget.contains(hit);
}

// 본문 인라인 편집 — 표시(prose)와 편집(textarea) 토글.
// 무엇을: 본문 영역을 클릭해 textarea 로 전환, 저장 버튼·Cmd/Ctrl+Enter 저장(blur 저장 없음), Escape 취소.
// 모바일은 저장/취소 버튼 대신 하단 편집 바(onEditingChange)가 저장 경로(WP-196).
// 빈 본문은 허용(스키마는 max 길이만 제약). 변화 없으면 PATCH 생략.
function InlineEditableBody({
  body,
  onSave,
  disabled,
  projectKey,
  issueNumber,
  onEditStart,
  onEditingChange,
  hideActions = false,
  mobile = false,
}: {
  body: string | null;
  // 저장 성공 여부 — false 면 입력을 버리지 않고 편집을 다시 연다(#611 충돌 시 본문 유실 방지).
  onSave: (next: string) => Promise<boolean>;
  disabled: boolean;
  projectKey: string;
  issueNumber: number;
  // 편집 진입 알림 — 호출부가 이 시점의 이슈 version 을 저장 기준으로 고정한다(#611).
  onEditStart?: () => void;
  // 편집 시작/종료 알림 — 편집 중엔 저장·취소 컨트롤을, 끝나면 null(모바일 하단 편집 바, WP-196).
  onEditingChange?: (controls: EditBarControls | null) => void;
  // 모바일 — 저장·취소는 하단 편집 바가 맡으므로 본문 아래 버튼을 숨긴다(이미지 버튼은 유지).
  hideActions?: boolean;
  // 모바일 — 편집 박스의 -mx-3(뷰 모드 박스 정렬용)을 빼서 16px 거터를 지킨다. 넣으면 테두리가 화면 끝 4px 까지 붙었다(디자인 리뷰).
  mobile?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body ?? '');
  // 편집 진입 시 발견된 로컬 초안이 서버 본문과 달라 복구 배너를 보여줄지 여부.
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  const draftKey = bodyDraftKey(projectKey, issueNumber);

  // 이미지 붙여넣기·드롭·버튼 업로드(WP-199) — 업로드 중엔 본문에 자리표시 토큰이 들어가 있다.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 편집 진입 후 캐럿 초기화(끝으로) 완료 여부 — 진입마다 한 번만.
  const caretInit = useRef(false);
  // 업로드 콜백은 비동기라 렌더 시점 draft 가 아니라 항상 최신 값을 봐야 한다 — ref 로 미러링.
  const draftRef = useRef(draft);
  // 렌더 중 ref 쓰기는 금지(react-hooks/refs) — 커밋 후 effect 로 동기화. 업로드 setValue 는 ref 를 즉시 갱신한다.
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const images = useIssueImageUpload({
    projectKey,
    textareaRef,
    getValue: () => draftRef.current,
    setValue: (v) => {
      draftRef.current = v;
      setDraft(v);
    },
    enabled: !disabled,
  });
  const uploading = images.isUploading;

  // 저장 없이 새로고침/탭 닫기로 이탈 시 경고(#823) — 코멘트 작성창(#620)·이슈 생성
  // 다이얼로그와 동일 패턴. beforeunload 만 커버하므로 SPA 내부 네비게이션(사이드바 링크·
  // 뒤로가기)은 아래 localStorage 초안 자동저장(#824)으로 보완한다. 이 경고는 그대로 유지.
  useUnsavedChangesWarning(editing && draft !== (body ?? ''));

  // 편집 중 draft 변경을 디바운스(600ms)로 localStorage 에 저장(#824) — 라우터에 의존하지
  // 않으므로 사이드바 링크·뒤로가기·탭 종료·브라우저 크래시까지 전부 커버한다.
  // 주의: draft 가 서버 본문과 같아졌다고 여기서 즉시 지우면 안 된다 — 편집 진입 직후에는
  // draft 가 항상 body 로 초기화되므로, 아직 [불러오기]로 확인하지 않은 기존 초안(있다면)을
  // 이 렌더에서 곧바로 지워버려 복구 배너의 대상이 사라진다. 정리는 save/cancel/discard 시점에만.
  useEffect(() => {
    if (!editing) return;
    if (draft === (body ?? '')) return;
    const timer = window.setTimeout(() => writeBodyDraft(draftKey, draft), 600);
    return () => window.clearTimeout(timer);
  }, [editing, draft, body, draftKey]);

  // 표시 → 편집 진입. 진입 시 최신 본문으로 draft 초기화하되, 저장된 초안이 서버 본문과
  // 다르면 조용히 덮어쓰지 않고 배너로 안내(다른 사람이 서버 본문을 바꿨을 수 있음).
  const enter = () => {
    setDraft(body ?? '');
    const stored = readBodyDraft(draftKey);
    setShowDraftBanner(stored != null && stored !== (body ?? ''));
    caretInit.current = false;
    setEditing(true);
    onEditStart?.();
  };
  // 배너 [불러오기] — 저장된 초안을 draft 로 복원.
  const restoreDraft = () => {
    const stored = readBodyDraft(draftKey);
    if (stored != null) setDraft(stored);
    setShowDraftBanner(false);
  };
  // 배너 [버리기] — 초안 폐기, 현재(서버) draft 유지.
  const discardDraft = () => {
    clearBodyDraft(draftKey);
    setShowDraftBanner(false);
  };
  // 저장 — 빈 값 허용, 변화 없으면 무의미 요청 차단. 저장 후 초안은 정리해 남기지 않는다.
  const save = async () => {
    // 업로드 중 자리표시 토큰이 서버에 저장되지 않도록 단축키·버튼 공통으로 막는다.
    const block = images.pendingBlock(draft);
    if (block === 'uploading') return;
    if (block === 'stale-token') {
      // 진행 중 업로드가 없는데 토큰이 남은 건 복원된 초안의 잔재 — 조용히 무시하면 저장이 안 되는 이유를 알 수 없다.
      toast.error('업로드가 끝나지 않은 이미지가 있습니다. 해당 줄을 지우고 다시 저장해 주세요');
      return;
    }
    setEditing(false);
    setShowDraftBanner(false);
    if (draft === (body ?? '')) {
      clearBodyDraft(draftKey);
      return;
    }
    // #611 초안은 저장이 성공한 뒤에만 지운다 — 충돌(409)·오류로 실패하면 입력한 본문을 그대로 두고 편집을 다시 연다.
    writeBodyDraft(draftKey, draft);
    if (await onSave(draft)) clearBodyDraft(draftKey);
    else {
      caretInit.current = false;
      setEditing(true);
    }
  };
  // 취소 — draft 폐기, 편집 종료. 초안도 함께 정리(#824 — 취소 시 남기지 않음).
  const cancel = () => {
    setEditing(false);
    setShowDraftBanner(false);
    clearBodyDraft(draftKey);
  };

  // 편집 바에 넘긴 컨트롤이 항상 최신 save/cancel(최신 draft)을 부르도록 ref 경유.
  const saveRef = useRef(save);
  const cancelRef = useRef(cancel);
  useEffect(() => {
    saveRef.current = save;
    cancelRef.current = cancel;
  });
  // 제목과 같은 규칙 — 편집 중이 아닐 땐 아무것도 보내지 않고, 지우기는 편집 중이던 실행의 cleanup 에서만.
  useEffect(() => {
    if (!onEditingChange || !editing) return;
    // 업로드 중엔 저장·취소 모두 막는다(기존 버튼과 같은 조건).
    onEditingChange({ save: () => void saveRef.current(), cancel: () => cancelRef.current(), disabled: disabled || uploading });
    return () => onEditingChange(null);
  }, [editing, disabled, uploading, onEditingChange]);

  if (!editing) {
    return (
      // Jira 식 — 본문 영역 전체가 클릭 가능. 호버 시 배경 변화로 편집 가능 신호.
      // role/aria-label/키보드(Enter·Space) 로 접근성 확보(article 은 button 자식 불가라 div+role).
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="본문 편집"
        aria-disabled={disabled}
        onClick={(e) => {
          if (disabled || isFromInteractiveDescendant(e)) return;
          enter();
        }}
        onKeyDown={(e) => {
          if (disabled || isFromInteractiveDescendant(e)) return;
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
          <MarkdownMessage renderImage={(p) => <IssueBodyImage projectKey={projectKey} {...p} />}>
            {body}
          </MarkdownMessage>
        ) : (
          <em className="text-sm text-muted-foreground">본문 없음</em>
        )}
      </div>
    );
  }

  return (
    // -mx-3 으로 뷰 모드 박스(-mx-3 px-3)와 좌우 위치를 일치시켜 전환 시 여백 변화 제거(데스크톱). 모바일은 거터 우선이라 뺀다.
    <div className={cn('space-y-2', !mobile && '-mx-3')}>
      {/* 초안 복구 배너(#824) — 편집 진입 시 로컬에 남은 초안이 서버 본문과 다를 때만 노출. */}
      {showDraftBanner && (
        <div
          data-testid="issue-body-draft-banner"
          className="flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          <span>작성 중이던 내용이 있습니다</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={restoreDraft}
              data-testid="issue-body-draft-restore"
            >
              불러오기
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={discardDraft}
              data-testid="issue-body-draft-discard"
            >
              버리기
            </Button>
          </div>
        </div>
      )}
      <Textarea
        autoFocus
        // 편집 진입 시 캐럿을 끝으로 — 기본 0 이면 이미지 버튼이 본문 맨 앞에 삽입한다. 포커스 시 한 번만.
        onFocus={(e) => {
          if (caretInit.current) return;
          caretInit.current = true;
          const n = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(n, n);
        }}
        data-testid="issue-body-textarea"
        className="min-h-[160px]"
        ref={textareaRef}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onPaste={images.onPaste}
        onDrop={images.onDrop}
        onDragOver={images.onDragOver}
        onKeyDown={(e) => {
          // 단축키: Cmd/Ctrl+Enter 저장 · Esc 취소. (blur 저장 없음 — 명시적 버튼 사용)
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            // 업로드 중 취소하면 재진입 시 draft 가 초기화돼 완료된 이미지 토큰이 유실된다 — 끝날 때까지 무시.
            if (!uploading) cancel();
          }
        }}
      />
      {/* 편집 액션 — 하단 좌측 저장/취소(Jira 식). 모바일(hideActions)은 하단 편집 바가 대신한다. */}
      <div className="flex items-center gap-2">
        {!hideActions && (
          <>
            <Button
              size="sm"
              onClick={save}
              disabled={disabled || uploading}
              data-testid="issue-body-save"
            >
              저장
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={disabled || uploading}
              data-testid="issue-body-cancel"
            >
              취소
            </Button>
          </>
        )}
        {/* 이미지 첨부 — 버튼 선택 외에 붙여넣기·드롭도 지원함을 안내(우측 정렬). */}
        <IssueBodyImageButton className="ml-auto" onFiles={images.uploadFiles} disabled={disabled} />
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
  const { data, isLoading, error, refetch } = useIssue(key, issueNumber);
  const update = useUpdateIssue(key, issueNumber);
  // #611 제목·본문은 편집을 시작한 순간의 version 을 저장 기준으로 고정한다 — 편집하는 사이 코멘트 SSE·창 포커스 리페치로 캐시 version 이
  // 올라가도, 그 사이 다른 사람이 바꾼 내용을 모른 채 덮어쓰지 않고 409 로 알 수 있게.
  const titleBaseVersion = useRef<number | undefined>(undefined);
  const bodyBaseVersion = useRef<number | undefined>(undefined);
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
  const watcherCount = watchers.data?.length ?? 0;
  const mobileWatchLabel = isWatching ? `구독 중 · ${watcherCount}명` : '구독하기';
  // 삭제 확인 다이얼로그 open 상태 — shadcn AlertDialog 제어형.
  const [deletePending, setDeletePending] = useState(false);
  // 채팅 드로워 open 상태 — URL ?chat=1 (시스템 뒤로가기가 드로워부터 닫도록, H2). 헤더 채팅 버튼으로 연다.
  const { open: chatOpen, openChat, closeChat } = useIssueChatDrawerParam();
  // 첨부 삭제 권한 UI 토글용 — 첨부자 또는 OWNER. 백엔드 가드가 최종 검증.
  const members = useProjectMembers(key);
  const isOwner =
    members.data?.some((m) => m.userId === user?.id && m.role === 'OWNER') ?? false;

  // WP-54: AI 채팅 화면 컨텍스트 — 이 이슈를 "보고 있는 대상"으로 등록(데이터 로딩 전엔 미등록).
  // Rules of Hooks: 아래 조기 반환 이전에 호출한다. 개인 프로젝트 리다이렉트 경로에선 곧 언마운트되어 해제된다.
  const screenContext = useMemo(
    () => (data ? buildIssueDetailContext({ projectKey: key, issue: data.summary }) : null),
    [data, key],
  );
  useRegisterAiScreenContext(screenContext);

  // #885 이전 화면으로 돌아가기 — 헤더 ← 버튼과 ESC 가 같은 복귀 동작을 쓴다.
  // 로딩·오류·개인 프로젝트 리다이렉트 중에는 헤더가 없으므로 ESC 도 걸지 않는다.
  // AI 패널이 열려 있으면 ESC 는 패널을 닫는 데 쓰이므로(AIChip) 그동안은 양보한다.
  const returnToOrigin = useReturnToIssueOrigin(key);
  const { mode: aiMode } = useAssistant();
  const canReturn =
    !!data && project.data?.type !== 'PERSONAL' && !isNotFoundError(error) && aiMode === 'closed';
  useReturnOnEscape(returnToOrigin, canReturn);

  // 프로젝트 타입이 확정되기 전에는 렌더 보류 — 팀 화면 반짝임 방지.
  if (project.isLoading) return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  if (project.error)
    return (
      <ResourceErrorState
        icon={FileQuestion}
        title="프로젝트를 불러올 수 없습니다"
        description="요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다."
        actionLabel="프로젝트 목록으로"
        onAction={() => navigate('/projects')}
      />
    );
  // 개인 프로젝트의 이슈 풀페이지 진입(알림/북마크)은 프로젝트 화면의 우측 패널로 리다이렉트한다.
  // 팀 프로젝트는 기존 풀페이지 유지.
  if (project.data?.type === 'PERSONAL') {
    return <Navigate to={`/projects/${key}?task=${issueNumber}`} replace />;
  }

  if (isLoading) return <p className="w-full p-6 text-muted-foreground">로딩 중…</p>;
  // 원격 삭제(resource.changed deleted) 후 재조회가 404 면 TanStack Query 가 마지막 data 를 남기므로,
  // data 유무보다 먼저 404 를 확인해 stale 이슈(편집 컨트롤 포함) 대신 not-found 상태를 보여준다.
  if (isNotFoundError(error))
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
  const patch = async (changes: UpdateIssueRequest, options?: { silent?: boolean }): Promise<boolean> => {
    const savedFrom = data?.summary.version;
    try {
      const updated = await update.mutateAsync(changes);
      // #611 내 저장으로 오른 version 은 충돌이 아니다 — 저장 직전 최신이던 편집 기준 version 을 함께 올려, 본문을 쓰는 중에 상태만
      // 바꾼 뒤 본문을 저장해도 스스로와 충돌하지 않게 한다(그 사이 다른 사람의 변경이 있었다면 기준이 이미 달라 그대로 409).
      for (const base of [titleBaseVersion, bodyBaseVersion]) {
        if (base.current !== undefined && base.current === savedFrom) base.current = updated.summary.version;
      }
      if (!options?.silent) toast.success('이슈 필드가 업데이트되었습니다');
      return true;
    } catch (e) {
      // 실패 토스트(409 충돌 안내 포함)는 useUpdateIssue 가 띄운다. 409 면 편집 기준을 풀어 다시 저장할 때 새로 불러온 최신 version 을 쓰게 한다.
      if (isAxiosError(e) && e.response?.status === 409) {
        titleBaseVersion.current = undefined;
        bodyBaseVersion.current = undefined;
      }
      return false;
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
        onClick={() => toggleWatch.mutate(!isWatching)}
        aria-pressed={isWatching}
        aria-label={isMobile ? mobileWatchLabel : isWatching ? '구독 중' : '구독'}
        data-testid="watch-toggle"
        disabled={toggleWatch.isPending}
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
              parent={summary.parent}
              status={summary.status}
              priority={summary.priority}
              dueDate={summary.dueDate}
              startDate={summary.startDate}
              milestoneId={summary.milestoneId}
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
              variant={variant}
            />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <IssueBreadcrumbHeader
        projectKey={key}
        projectName={project.data?.name ?? ''}
        parent={summary.parent}
        number={summary.number}
        type={summary.type}
        onBack={returnToOrigin}
        // 모바일: 채팅은 ⋯ 밖 아이콘(M5), ⋯ 에는 구독·삭제만. 데스크톱은 actions 한 줄 그대로.
        mobilePrimaryAction={chatButton}
        mobileActions={secondaryActions}
        actions={
          <>
            {chatButton}
            {secondaryActions}
          </>
        }
      />
      {/* #354: @container 로 "행이 들어갈 실제 너비"를 기준 삼아 3분할↔세로스택을 전환한다(아래 @min-[1032px]).
          뷰포트 기준 lg 는 AI 사이드패널이 main 을 좁혀도 3분할을 유지해, 좁아진 영역에서 본문이 붕괴되고
          채팅·레일이 AI 패널 뒤로 밀려 가려졌다(오버레이 증상). */}
      <div className="@container flex-1 overflow-y-auto">
        {/* 3구역 flex: [메인 본문][채팅 패널][속성 레일] — 컨테이너 폭 1032px(본문360+채팅320+레일280+gap/padding) 이상에서 가로 배치 (#343 Task 4, #354). */}
        <div className={cn('w-full flex flex-col', isMobile ? 'gap-4 p-4' : 'gap-6 p-6', '@min-[1032px]:flex-row')}>
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
                  onSave={(t) => patch({ title: t, version: titleBaseVersion.current })}
                  onEditStart={() => {
                    titleBaseVersion.current = summary.version;
                    setLastEditor('title');
                  }}
                  disabled={!canEditContent || update.isPending}
                  commitOnBlur={!isMobile}
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
                </div>
              )}
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
                onSave={(b) => patch({ body: b, version: bodyBaseVersion.current })}
                onEditStart={() => {
                  bodyBaseVersion.current = summary.version;
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
              hideComposer={isMobile}
            />
          </div>
          {/* 채팅은 헤더 버튼 → 드로워(IssueChatDrawer)로 분리(구 인라인 패널 제거). */}
          {/* 속성 레일 — data-testid 은 IssuePropertyRail 내부에 있음. #354: 뷰포트 lg → 컨테이너 1032px 기준. */}
          {!isMobile && (
            <aside className="w-full shrink-0 @min-[1032px]:w-[280px]">{renderRail('rail')}</aside>
          )}
        </div>
      </div>
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
              keepFocusOnSubmit
              inlineSubmit
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
            {renderRail('sheet')}
          </div>
        </MobileSheetShell>
      )}
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
        onClose={closeChat}
      />
    </div>
  );
}
