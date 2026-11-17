// 이슈 본문 인라인 편집 — 팀 이슈 상세 본문과 개인 작업 상세 메모가 함께 쓴다(WP-1374 에서 IssueDetailPage 에서 꺼냄).
// 왜 공용인가: 개인 작업 메모도 팀 이슈 본문과 같은 렌더(마크다운·멘션 칩·본문 이미지)와 같은 편집(원문 편집칸·저장/취소·초안 자동 저장)을
// 써야 두 화면이 어긋나지 않는다. 동작은 옮기기 전과 같다.
// WP-1656: 편집칸은 Textarea 대신 본문 모드 RichInput — 원문(마크다운)을 한 바이트도 바꾸지 않으면서 붙여넣은 이미지를 칸 안에 그림으로 보인다.
import { type Ref, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { uploadIssueImage } from '@/api/issueImages';
import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
import { IssueBodyImage } from '@/components/issue/IssueBodyImage';
import { IssueBodyImageButton } from '@/components/issue/IssueBodyImageButton';
import { IssueMentionChip } from '@/components/mentions/IssueMentionChip';
import type { RenderMention } from '@/components/mentions/parseMessageSegments';
import { RichInput, type RichInputHandle } from '@/components/mentions/RichInput';
import { type MentionUser, toMentionUser } from '@/components/mentions/types';
import type { EditBarControls } from '@/components/mobile/MobileEditBar';
import { useEditBarControls } from '@/components/mobile/useEditBarControls';
import { Button } from '@/components/ui/button';
import { useProjectMembers } from '@/hooks/queries/useProjectMembers';
import { useAuth } from '@/hooks/useAuth';
import { useRestoreFocusOnExit } from '@/hooks/useRestoreFocusOnExit';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { clearIssueBodyDraft, issueBodyDraftKey, readIssueBodyDraft, writeIssueBodyDraft } from '@/lib/issueBodyDraft';
import { isBodyDraftDirty, isSameBody } from '@/lib/issueDraft';
import { hasPendingToken } from '@/lib/markdownImageInsert';
import { cn } from '@/lib/utils';
import { ISSUE_BODY_MAX_LENGTH, issueTextOverLimitMessage } from '@/lib/validations/issue';

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

/**
 * 보기 모드 본문 래퍼와 겹치는 글자 선택(공백만이 아닌)이 있는가(WP-1412).
 * 왜: 본문 글자를 드래그해 고르면 끝(mouseup)에 브라우저가 click 을 내는데, 이를 편집 진입으로 처리하면 선택이 사라지고
 * 편집창으로 바뀌어 복사할 수 없었다. 페이지 다른 곳의 선택은 본문 클릭을 막지 않는다. 공백만 고른 선택은 고른 글자가 없어
 * 선택으로 치지 않는다(줄 링크 메뉴 rowLinkMenuAnchor 와 같은 규칙).
 * 주의: 이미 고른 글자 위를 한 번 누르면 Chrome 은 click 이 끝난 뒤에야 선택을 접는다 — click 시점엔 선택이 남아 있으므로
 * 호출부는 누른 뒤 선택이 바뀌었을 때(드래그로 고름·Shift+클릭으로 넓힘)만 이 판정을 쓴다(selectionChangedSince).
 */
function hasTextSelectionWithin(el: Element): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (!selection.getRangeAt(0).intersectsNode(el)) return false;
  return selection.toString().trim() !== '';
}

/** 누른 순간의 선택 양 끝 — Selection 은 살아 있는 객체라 값을 떠 둔다. 선택이 없거나 접혔으면 null(WP-1412). */
type SelectionSnapshot = { anchorNode: Node | null; anchorOffset: number; focusNode: Node | null; focusOffset: number } | null;

/** 지금 선택의 양 끝을 떠 둔다(WP-1412). */
function snapshotSelection(): SelectionSnapshot {
  const s = window.getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return null;
  return { anchorNode: s.anchorNode, anchorOffset: s.anchorOffset, focusNode: s.focusNode, focusOffset: s.focusOffset };
}

/** 누른 뒤 선택이 바뀌었는가(WP-1412) — 드래그로 새로 고르거나 Shift+클릭으로 넓히면 바뀐다. 고른 글자 위를 그냥 누르면 그대로다. */
function selectionChangedSince(before: SelectionSnapshot): boolean {
  const now = snapshotSelection();
  if (before === null || now === null) return before !== now;
  return (
    before.anchorNode !== now.anchorNode ||
    before.anchorOffset !== now.anchorOffset ||
    before.focusNode !== now.focusNode ||
    before.focusOffset !== now.focusOffset
  );
}

/** 감싼 화면이 부르는 동작 — 초안 저장 키(사용자·워크스페이스·이슈) 규칙을 바깥이 몰라도 되게 이 컴포넌트가 맡는다. */
export interface InlineEditableBodyHandle {
  /** 로컬 초안(localStorage, #824)을 지운다 — 「버리고 닫기」 뒤 다음 편집에 「작성 중이던 내용」으로 되살아나지 않게(WP-1374). */
  discardDraft: () => void;
}

// 본문 인라인 편집 — 표시(prose)와 편집(원문 편집칸 — 본문 모드 RichInput, WP-1656) 토글.
// 무엇을: 본문 영역을 클릭해 편집칸으로 전환, 저장 버튼·Cmd/Ctrl+Enter 저장(blur 저장 없음), Escape 취소. Enter 는 줄바꿈.
// 모바일은 저장/취소 버튼 대신 하단 편집 바(onEditingChange)가 저장 경로(WP-196).
// 빈 본문은 허용(스키마는 max 길이만 제약). 변화 없으면 PATCH 생략.
export function InlineEditableBody({
  body,
  onSave,
  disabled,
  projectKey,
  issueNumber,
  onEditStart,
  onEditingChange,
  hideActions = false,
  mobile = false,
  editLabel = '본문 편집',
  onDirtyChange,
  ref,
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
  // 보기 영역의 접근성 이름 — 개인 작업 메모는 「메모 편집」(WP-1374). 기본은 팀 이슈 본문의 「본문 편집」.
  editLabel?: string;
  // 고친 채 저장하지 않은 내용이 있는가 알림 — 감싼 모달이 닫기 전에 확인을 묻는 데 쓴다(개인 작업 상세, WP-1374). 사라질 때 false.
  onDirtyChange?: (dirty: boolean) => void;
  // 바깥에서 초안을 지울 때(개인 작업 모달 「버리고 닫기」) — InlineEditableBodyHandle.
  ref?: Ref<InlineEditableBodyHandle>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body ?? '');
  // 편집 진입 시 발견된 로컬 초안이 서버 본문과 달라 복구 배너를 보여줄지 여부.
  const [showDraftBanner, setShowDraftBanner] = useState(false);
  // 초안은 쓴 사람(사용자·워크스페이스) 몫 — 같은 기기의 다른 사용자에게 보이지 않게(WP-699).
  const { user, activeTenant } = useAuth();
  const draftKey = issueBodyDraftKey(
    { userId: user?.id ?? 0, tenantId: activeTenant?.tenantId ?? null },
    projectKey,
    issueNumber,
  );

  // 바깥 동작 — 초안 키를 감싼 화면이 다시 만들지 않게 여기서 지운다.
  useImperativeHandle(ref, () => ({ discardDraft: () => clearIssueBodyDraft(draftKey) }), [draftKey]);

  // 편집칸(본문 모드 RichInput) 핸들 — 「이미지」 버튼이 커서 자리에 이미지를 넣는다(insertImages).
  const richRef = useRef<RichInputHandle | null>(null);
  // 편집칸을 새로 만드는 번호 — RichInput 은 원문(initialBody)을 마운트 때 한 번만 읽으므로, 편집 진입·초안 불러오기마다 올려 새 원문으로 연다.
  const [editorKey, setEditorKey] = useState(0);
  // 편집칸 안에 업로드 중인 이미지(자리표시)가 있는가 — RichInput 이 바뀔 때만 알린다(onUploadingChange). 저장·취소·단축키·모바일 바를 막는다.
  const [uploading, setUploading] = useState(false);
  // WP-885: 본문 상한(5만자) 초과 여부 — 넘으면 서버가 400 으로 돌려보내 토스트만 뜨므로 저장 전에 막고 입력창 아래에 안내한다.
  // 편집칸은 입력을 자르지 않는다(붙여넣기 내용 유실 방지) — 저장만 막는다.
  const overLimit = draft.length > ISSUE_BODY_MAX_LENGTH;

  // 저장 없이 새로고침/탭 닫기로 이탈 시 경고(#823) — 코멘트 작성창(#620)·이슈 생성
  // 다이얼로그와 동일 패턴. beforeunload 만 커버하므로 SPA 내부 네비게이션(사이드바 링크·
  // 뒤로가기)은 아래 localStorage 초안 자동저장(#824)으로 보완한다. 이 경고는 그대로 유지.
  const dirty = isBodyDraftDirty(editing, draft, body);
  useUnsavedChangesWarning(dirty);
  // 감싼 화면에 알린다 — 편집칸이 사라지면(모달째 닫힘·다른 작업으로 바뀜) 고친 내용도 함께 없어지므로 false 로 돌린다.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // 편집 중 draft 변경을 디바운스(600ms)로 localStorage 에 저장(#824) — 라우터에 의존하지
  // 않으므로 사이드바 링크·뒤로가기·탭 종료·브라우저 크래시까지 전부 커버한다.
  // 주의: draft 가 서버 본문과 같아졌다고 여기서 즉시 지우면 안 된다 — 편집 진입 직후에는
  // draft 가 항상 body 로 초기화되므로, 아직 [불러오기]로 확인하지 않은 기존 초안(있다면)을
  // 이 렌더에서 곧바로 지워버려 복구 배너의 대상이 사라진다. 정리는 save/cancel/discard 시점에만.
  // 업로드 중엔 쓰지 않는다(WP-1656) — 자리표시는 원문에 실리지 않아(빈 글자) 그대로 쓰면 이미지가 빠진 초안이 남고, 그 초안을 불러오면
  // 이미지가 조용히 사라진다. 마지막 초안을 둔 채 기다렸다가 업로드가 끝나면(uploading=false) 이미지가 든 원문으로 다시 쓴다.
  useEffect(() => {
    if (!editing || uploading) return;
    if (isSameBody(draft, body)) return;
    const timer = window.setTimeout(() => writeIssueBodyDraft(draftKey, draft), 600);
    return () => window.clearTimeout(timer);
  }, [editing, uploading, draft, body, draftKey]);

  // 표시 → 편집 진입. 진입 시 최신 본문으로 draft 초기화하되, 저장된 초안이 서버 본문과
  // 다르면 조용히 덮어쓰지 않고 배너로 안내(다른 사람이 서버 본문을 바꿨을 수 있음).
  // 편집칸을 지금 draft 로 새로 만든다(편집칸은 원문을 마운트 때만 읽는다). 새 편집칸은 업로드 중 이미지가 없으므로 업로드 상태도 푼다
  // (옛 편집칸의 업로드는 그 편집칸과 함께 버려진다). 편집 진입·초안 불러오기가 같이 쓴다.
  const remountEditor = () => {
    setEditorKey((k) => k + 1);
    setUploading(false);
  };
  const enter = () => {
    setDraft(body ?? '');
    const stored = readIssueBodyDraft(draftKey);
    setShowDraftBanner(stored != null && !isSameBody(stored, body));
    remountEditor();
    setEditing(true);
    onEditStart?.();
  };
  // 배너 [불러오기] — 저장된 초안을 draft 로 복원하고 편집칸을 그 원문으로 새로 연다.
  const restoreDraft = () => {
    const stored = readIssueBodyDraft(draftKey);
    if (stored != null) {
      setDraft(stored);
      remountEditor();
    }
    setShowDraftBanner(false);
  };
  // 배너 [버리기] — 초안 폐기, 현재(서버) draft 유지.
  const discardDraft = () => {
    clearIssueBodyDraft(draftKey);
    setShowDraftBanner(false);
  };
  // 저장 — 빈 값 허용, 변화 없으면 무의미 요청 차단. 저장 후 초안은 정리해 남기지 않는다.
  // next: 저장할 원문 — 단축키(Cmd/Ctrl+Enter)는 편집칸이 지금 원문을 넘기고, 버튼·모바일 바는 draft(편집칸이 알린 원문)를 쓴다. 둘은 같다.
  const save = async (next: string = draft) => {
    // 업로드 중 이미지(자리표시)는 원문에 실리지 않으므로 그대로 저장하면 이미지가 빠진다 — 단축키·버튼·모바일 바 공통으로 막는다.
    if (uploading) return;
    // 단축키(Cmd/Ctrl+Enter)·모바일 하단 바 저장도 같은 경로라 여기서 한 번에 막는다(WP-885).
    if (next.length > ISSUE_BODY_MAX_LENGTH) return;
    if (hasPendingToken(next)) {
      // 옛 Textarea 편집칸(WP-199)이 남긴 자리표시 토큰이 복원된 초안에 남아 있다 — 조용히 무시하면 저장이 안 되는 이유를 알 수 없다.
      toast.error('업로드가 끝나지 않은 이미지가 있습니다. 해당 줄을 지우고 다시 저장해 주세요');
      return;
    }
    setEditing(false);
    setShowDraftBanner(false);
    // 원문 그대로 비교(다듬지 않음) — 열고 그대로 저장하면 요청이 없다(WP-1656 원문 보존).
    // \r\n 원문은 편집칸이 \n 줄로 읽으므로 \n 으로 바꾼 모양과 같으면 바뀌지 않은 것이다(isSameBody).
    if (isSameBody(next, body)) {
      clearIssueBodyDraft(draftKey);
      return;
    }
    // #611 초안은 저장이 성공한 뒤에만 지운다 — 충돌(409)·오류로 실패하면 입력한 본문을 그대로 두고 편집을 다시 연다.
    // 다시 여는 편집칸은 draft(= 이 원문)로 새로 만들어진다.
    setDraft(next);
    writeIssueBodyDraft(draftKey, next);
    if (await onSave(next)) clearIssueBodyDraft(draftKey);
    else setEditing(true);
  };
  // 취소 — draft 폐기, 편집 종료. 초안도 함께 정리(#824 — 취소 시 남기지 않음).
  const cancel = () => {
    setEditing(false);
    setShowDraftBanner(false);
    clearIssueBodyDraft(draftKey);
  };
  // Esc 취소 — 업로드 중엔 무시한다(지금처럼). 취소하면 재진입 때 편집칸이 서버 본문으로 새로 열려 올리던 이미지를 잃는다.
  const cancelByEscape = () => {
    if (!uploading) cancel();
  };

  // 본문의 멘션 토큰 <@id> → 코멘트와 같은 칩(WP-1134). 이름표는 프로젝트 멤버(코멘트 목록과 같은 쿼리라 다시 받지 않는다) — 멤버가 아니면
  // 「알 수 없음」. 코드(`…`·펜스) 안의 토큰은 MarkdownMessage 가 글자 그대로 둔다. 멤버가 바뀔 때만 새로 만든다 — mentions 가 바뀌면
  // MarkdownMessage 가 렌더러를 다시 만들어 본문 이미지가 다시 마운트된다.
  const members = useProjectMembers(projectKey);
  const mentionUsers: MentionUser[] = useMemo(
    () => (members.data ?? []).map(toMentionUser),
    [members.data],
  );
  const renderMention = useCallback<RenderMention>(
    (seg, key) => <IssueMentionChip key={key} seg={seg} testId={`issue-body-mention-chip-${seg.id}`} />,
    [],
  );
  const renderImage = useCallback(
    (p: { src?: string; alt?: string }) => <IssueBodyImage projectKey={projectKey} {...p} />,
    [projectKey],
  );

  // 편집칸(본문 모드 RichInput)에 넘기는 객체·함수 — 키 입력마다 draft 가 바뀌어 다시 그려지므로, 값이 바뀔 때만 새로 만든다.
  // 본문 모드 설정(이 프로젝트), 입력칸 접근성 상태(5만 자 초과면 오류 — 아래 안내 문구를 가리킨다, 권한이 없어지면 비활성), 이미지 업로드.
  const bodyMode = useMemo(() => ({ projectKey }), [projectKey]);
  const editorAria = useMemo(
    () => ({ invalid: overLimit, describedBy: overLimit ? 'issue-body-limit-error' : undefined, disabled }),
    [overLimit, disabled],
  );
  const imageUpload = useCallback((file: File) => uploadIssueImage(projectKey, file), [projectKey]);

  // 편집이 끝나면(Esc 취소·저장) 편집칸이 사라져 포커스가 body 로 빠졌다 — 「본문 편집」 영역으로 돌린다(WP-813).
  const viewRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocusOnExit(editing, viewRef);
  // 보기 영역을 누른 순간의 선택 — click 이 글자를 고른(바꾼) 끝인지 그냥 누름인지 가르는 데 쓴다(WP-1412). 누름이 없으면 null.
  const pressSelection = useRef<{ before: SelectionSnapshot } | null>(null);

  // 모바일 하단 편집 바 — 제목과 같은 훅. 업로드 중엔 저장·취소 모두 막는다(기존 버튼과 같은 조건).
  useEditBarControls(editing, { save, cancel, disabled: disabled || uploading || overLimit }, onEditingChange);

  if (!editing) {
    return (
      // Jira 식 — 본문 영역 전체가 클릭 가능. 호버 시 배경 변화로 편집 가능 신호.
      // role/aria-label/키보드(Enter·Space) 로 접근성 확보(article 은 button 자식 불가라 div+role).
      <div
        ref={viewRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={editLabel}
        aria-disabled={disabled}
        onPointerDown={() => {
          pressSelection.current = { before: snapshotSelection() };
        }}
        onPointerCancel={() => {
          // 브라우저가 누름을 거둔 경우(스크롤 시작 등) — 남은 기록이 다음 click 판정에 섞이지 않게 지운다.
          pressSelection.current = null;
        }}
        onClick={(e) => {
          const press = pressSelection.current;
          pressSelection.current = null;
          if (disabled || isFromInteractiveDescendant(e)) return;
          // 누른 뒤 본문 글자 선택이 바뀐 포인터 click(드래그·Shift+클릭)은 편집 진입이 아니다 — detail 0(키보드·보조기기·프로그램)은 늘 들어간다(WP-1412).
          if (e.detail !== 0 && press && selectionChangedSince(press.before) && hasTextSelectionWithin(e.currentTarget)) return;
          enter();
        }}
        onKeyDown={(e) => {
          if (disabled || isFromInteractiveDescendant(e)) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            enter();
          }
        }}
        // 호버 시 편집 모드(편집칸)와 동일한 border-input 테두리 + 패딩으로 "편집 필드" 미리보기.
        // 평소 border-transparent 로 두어 호버 시 레이아웃 시프트 방지.
        className="-mx-3 cursor-pointer rounded-md border border-transparent px-3 py-2 transition-colors hover:border-input hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* 뷰 모드 = 마크다운 렌더(## 제목·**볼드**·- [ ] 체크박스). 편집 모드(편집칸)는 원문 — 대비 확보. */}
        {body ? (
          <MarkdownMessage renderImage={renderImage} mentions={mentionUsers} renderMention={renderMention}>
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
      {/* 편집칸(본문 모드 RichInput, WP-1656) — 원문 줄 = 문단, 이 프로젝트 이미지는 칸 안 그림(보기 화면 크기). 원문은 다듬지 않고 draft 로 받는다.
          권한이 없어지면(disabled) inert 로 입력·포커스를 막고 Textarea 의 비활성 모양(흐리게·금지 커서)으로 보인다 — RichInput 에는 편집 끄기 속성이 없다.
          바깥 모달이 막은 Esc 도 RichInput 본문 모드가 처리한다(멘션 팝업 우선 → 그 밖엔 onCancel). */}
      <div
        inert={disabled}
        aria-disabled={disabled || undefined}
        data-testid="issue-body-editor-frame"
        className={cn(disabled && 'cursor-not-allowed opacity-50')}
      >
        <RichInput
          key={editorKey}
          ref={richRef}
          bodyMode={bodyMode}
          // 마운트 때 한 번 읽는다 — 편집 진입·불러오기·저장 실패 뒤 다시 열 때 그때의 draft 로 새로 만들어진다.
          initialBody={draft}
          initialMentions={mentionUsers}
          members={members.data ?? []}
          // 접근성 이름 — 「본문 편집」→「본문」, 개인 작업 「메모 편집」→「메모」(보기 영역 이름에서 동작어를 뗀다).
          ariaLabel={editLabel.replace(/\s*편집$/, '')}
          // 예전 편집칸(Textarea)처럼 안내 문구 없음 — 기본값(「메시지 입력…」)은 채팅용이다.
          placeholder=""
          autoFocus
          inputTestId="issue-body-textarea"
          submitTestId="issue-body-submit"
          // 입력칸 자체의 접근성 상태 — 옛 Textarea 처럼 입력칸에 오류·비활성이 달린다.
          editorAria={editorAria}
          // 최대 높이만 넘긴다(최소 160px 는 본문 모드가 단다). 데스크톱: 70vh 에서 멈추고 그 뒤는 안에서 스크롤 — 편집칸이 화면을 다 차지해
          // 아래 저장·취소 버튼이 밀려나지 않게(WP-1411). 모바일: 상한 없음 — 저장·취소는 하단 편집 바(MobileEditBar)에 있고,
          // vh 상한은 화면 아래를 덮는 키보드 뒤로 캐럿을 숨긴다.
          editorMaxHeightClass={mobile ? '' : 'max-h-[70vh]'}
          imageUpload={imageUpload}
          onBodyChange={setDraft}
          onUploadingChange={setUploading}
          onSubmit={(next) => {
            void save(next);
          }}
          onCancel={cancelByEscape}
        />
      </div>
      {/* WP-885: 상한 초과 안내 — 저장 버튼은 비활성, 단축키·모바일 저장은 save() 가드가 막는다. */}
      {overLimit && (
        <p id="issue-body-limit-error" role="alert" data-testid="issue-body-limit-error" className="text-sm text-destructive">
          {issueTextOverLimitMessage('본문', draft.length)}
        </p>
      )}
      {/* 편집 액션 — 하단 좌측 저장/취소(Jira 식). 모바일(hideActions)은 하단 편집 바가 대신한다. */}
      <div className="flex items-center gap-2">
        {!hideActions && (
          <>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={disabled || uploading || overLimit}
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
        <IssueBodyImageButton className="ml-auto" onFiles={(files) => richRef.current?.insertImages(files)} disabled={disabled} />
      </div>
    </div>
  );
}

