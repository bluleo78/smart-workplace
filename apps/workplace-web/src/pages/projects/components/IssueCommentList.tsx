// 이슈 코멘트 리스트 + 신규 작성 폼(IssueCommentComposer — 모바일은 hideComposer 로 빼고 화면 하단에 둔다, WP-196).
// useCreateComment 훅으로 작성 후 detail 쿼리 무효화로 갱신.
// 본인(HUMAN) 코멘트에만 수정·삭제 버튼 노출 (#154).
// #785: 작성/수정 입력을 shadcn Textarea 대신 이슈 채팅과 동일한 RichInput + 공용 멘션
// 파이프라인(lib/chat-mentions.ts, components/mentions/*)으로 교체 — @ 자동완성 지원.
// <@id> 토큰의 이름/종류는 코멘트 응답의 mentions(서버가 사용자 테이블에서 풀어 줌 — 프로젝트에서 빠진 사람 포함, WP-1095)와
// 프로젝트 멤버 목록으로 찾는다(읽기 렌더·수정 폼 초기값 공용). 구버전 서버(mentions 없음)는 멤버 목록만 쓴다.

import { Link2, MessageSquareShare, Pencil, Trash2 } from 'lucide-react';
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';

import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
import { ChatAvatar } from '@/components/chat/ChatAvatar';
import { LinkPreviewList } from '@/components/chat/LinkPreviewCard';
import { IssueBodyImage } from '@/components/issue/IssueBodyImage';
import { renderIssueKeyRef } from '@/components/issues/renderIssueKeyRef';
import { countApiImages, withImagePlaceholders } from '@/components/mentions/apiImageSegments';
import { IssueMentionChip } from '@/components/mentions/IssueMentionChip';
import { messagePlainText, type RenderMention } from '@/components/mentions/parseMessageSegments';
import { RichInput } from '@/components/mentions/RichInput';
import { type MentionCandidate, type MentionUser, toMentionUser } from '@/components/mentions/types';
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu';
import { ReactorsOverlay } from '@/components/reactions/ReactorsOverlay';
import { useReactionFocusRestore } from '@/components/reactions/useReactionFocusRestore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { PersonCardTrigger } from '@/components/users/personCard/PersonCardTrigger';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { focusRow, useListFocusRescue } from '@/hooks/useListFocusRescue';
import { useMessageListLongPress } from '@/hooks/useMessageListLongPress';
import { useRestoreFocusOnExit } from '@/hooks/useRestoreFocusOnExit';
import { appLinksOf, withoutMarkdownCode } from '@/lib/appLinks';
import { appUrl } from '@/lib/appUrl';
// 코멘트 행을 가운데로 — 상단 고정 헤더·하단 작성창에 가리지 않게(움직임 줄이기 설정이면 바로 옮긴다).
import { scrollIntoViewCentered } from '@/lib/scrollIntoViewCentered';
import { openSendToChat } from '@/lib/sendToChat';
import type { ShareTarget } from '@/lib/shareTarget';
import { cn } from '@/lib/utils';

import { uploadIssueImage } from '../../../api/issueImages';
import { commentReactorSource } from '../../../hooks/queries/commentReactorSource';
import { useAppHosts } from '../../../hooks/queries/useAppLinks';
import { useDeleteComment, useUpdateComment } from '../../../hooks/queries/useIssueComments';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useToggleCommentReaction } from '../../../hooks/queries/useToggleCommentReaction';
import { useAuth } from '../../../hooks/useAuth';
import { type ActivityOrder, DEFAULT_ACTIVITY_ORDER, orderActivity } from '../../../lib/activityOrder';
import { handleApiError } from '../../../lib/api-error';
import { copyToClipboard } from '../../../lib/copyToClipboard';
import { formatDateTimeMinute } from '../../../lib/formatters';
import { issueCommentPath } from '../../../lib/issueCommentLink';
import { commentOverLimitMessage, ISSUE_BODY_MAX_LENGTH } from '../../../lib/validations/issue';
import type { IssueCommentResponse } from '../../../types/issue';
import type { MentionResponse } from '../../../types/messaging';
import { AddReactionButton, CommentReactions } from './CommentReactions';
import { IssueCommentComposer } from './IssueCommentComposer';

/**
 * 코멘트 한 개의 멘션 이름표(WP-1095). 서버가 그 본문에서 풀어 준 멘션을 먼저 두고, 거기 없는 id 만 프로젝트 멤버에서 더한다(id 하나에 이름표
 * 하나 — 읽기 렌더·수정 폼이 같은 이름을 쓴다). 프로젝트에서 빠진 사람도 지난 코멘트에서 「알 수 없음」이 아니라 이름으로 보인다. 구버전
 * 서버(mentions 없음)는 멤버만 쓴다.
 */
function withCommentMentions(members: MentionUser[], mentions: MentionResponse[] | undefined): MentionUser[] {
  if (!mentions?.length) return members;
  const fromServer = mentions.map(({ id, name, kind }) => ({ id, name, kind }));
  const ids = new Set(fromServer.map((m) => m.id));
  return [...fromServer, ...members.filter((m) => !ids.has(m.id))];
}

// 개별 코멘트 항목 — 본인 HUMAN 코멘트에만 수정·삭제 액션 제공.
// memo(WP-2073): 페이지 레벨 상태(타이틀·본문 편집, 탭 전환 등)가 바뀌어 목록이 다시 그려져도 props 가 같으면
// 이 행은 다시 그려지지 않는다 — 코멘트 200개가 전부 다시 그려져 INP 가 늘어나지 않게(렌더 윈도우와 함께 쓰는 성능 잠금).
const CommentItem = memo(function CommentItem({
  comment,
  isOwn,
  projectKey,
  issueNumber,
  issueId,
  mentionUsers,
  mentionCandidates,
  canReact,
  touch,
  currentUserId,
  onOpenReactors,
  highlighted = false,
}: {
  comment: IssueCommentResponse;
  isOwn: boolean;
  projectKey: string;
  issueNumber: number;
  issueId: number;
  // 본문 <@id> 토큰 → 이름/종류 역매핑(읽기 렌더 + 수정 폼 초기 멘션 칩 복원 공용).
  mentionUsers: MentionUser[];
  // RichInput @ 자동완성 후보(프로젝트 멤버).
  mentionCandidates: MentionCandidate[];
  // 이모지 반응 추가·취소 가능 여부(코멘트 작성 권한, WP-504).
  canReact: boolean;
  // 터치 환경(모바일 폭 또는 coarse pointer) — 목록이 한 번 판정해 내려 준다.
  // WP-223: 모바일은 hover 가 없어 ⋯ → 액션 시트로 수정·삭제를 연다.
  // WP-237: ≥1024px 터치 태블릿(pointer: coarse)도 hover 가 없다 — 터치면 TouchRowActionsMenu 하나로
  // 폭에 따라 시트(<1024)/드롭다운(≥1024)을 연다. 삭제 확인창은 메뉴 밖에서 state 로 연다(메뉴가 닫혀도 유지).
  touch: boolean;
  currentUserId: number;
  // 반응자 전체 보기 열기(데스크톱 호버 카드 모두 보기) — 오버레이는 목록이 하나만 가진다(WP-504).
  // 목록의 안정적 콜백을 그대로 받으되 대상 코멘트 id 를 함께 받는다 — 감싸기는 이 컴포넌트 안에서만 해야
  // 목록 맵이 매 렌더 새 클로저를 만들지 않아 memo 가 무력화되지 않는다(WP-2073).
  onOpenReactors: (commentId: number, emoji: string) => void;
  // 링크로 열어 온 코멘트 — 잠시 테두리로 강조해 어느 코멘트인지 보이게 한다(WP-1175).
  highlighted?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 이 코멘트의 멘션 이름표 — 프로젝트 멤버 + 서버가 풀어 준 멘션(프로젝트에서 빠진 사람 포함, WP-1095).
  const commentMentionUsers = useMemo(
    () => withCommentMentions(mentionUsers, comment.mentions),
    [mentionUsers, comment.mentions],
  );
  // 수정을 끝내면(Esc 취소·저장) 편집기가 사라져 포커스가 body 로 빠졌다 — 「코멘트 수정」 버튼으로 돌린다(WP-813).
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  useRestoreFocusOnExit(editing, editButtonRef);
  // 코멘트 링크 복사(WP-1175) — 그 주소로 이슈를 열면 이 코멘트로 바로 간다. 누구의 코멘트든 복사할 수 있다.
  // 복사 토스트와 「채팅·이슈로 보내기」(WP-1236)는 같은 대상 — 받는 쪽에는 이슈 카드로 보이고 누르면 이 코멘트로 간다.
  const linkTarget: ShareTarget = {
    kind: 'issue',
    url: appUrl(issueCommentPath(projectKey, issueNumber, comment.id)),
    title: `${projectKey}-${issueNumber} 코멘트`,
  };
  const copyLink = () => {
    void copyToClipboard(linkTarget.url, {
      success: '코멘트 링크를 복사했습니다',
      failure: '코멘트 링크를 복사하지 못했습니다',
      successAction: { label: '채팅으로 보내기', onClick: () => openSendToChat(linkTarget) },
    });
  };
  const sendLink = () => openSendToChat(linkTarget);
  const commentActions: MobileSheetAction[] = [
    { key: 'copy-link', label: '링크 복사', icon: <Link2 />, onSelect: copyLink },
    { key: 'send-to-chat', label: '채팅·이슈로 보내기', icon: <MessageSquareShare />, onSelect: sendLink },
    ...(isOwn
      ? [
          { key: 'edit', label: '수정', icon: <Pencil />, onSelect: () => setEditing(true) },
          { key: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => setConfirmOpen(true) },
        ]
      : []),
  ];

  const update = useUpdateComment(projectKey, issueNumber, issueId);
  const remove = useDeleteComment(projectKey, issueNumber, issueId);

  const isAgent = comment.authorKind === 'AGENT';
  const { toggle } = useToggleCommentReaction(projectKey, issueNumber, issueId);
  const toggleReaction = (emoji: string) => toggle(comment.id, emoji);
  // 반응자 오버레이 열기 — 목록의 안정적 콜백(onOpenReactors)에 이 코멘트 id 를 미리 묶어 (emoji) 만 받는 모양으로 넘긴다.
  // CommentReactions·ReactionBar 는 (emoji) 시그니처라 여기서만 감싼다(WP-2073).
  const openReactorsForComment = useCallback(
    (emoji: string) => onOpenReactors(comment.id, emoji),
    [onOpenReactors, comment.id],
  );
  // 반응 없는 코멘트(마우스)의 😊+ 는 본문 아래가 아니라 헤더 hover 액션 자리에 둔다 — 빈 칩 줄이 공간을 차지하지 않게(WP-504).
  const headerReactionAdd = canReact && !touch && !editing && (comment.reactions ?? []).length === 0;
  // 반응 칩·헤더 「반응 추가」가 눌린 뒤 사라지면(첫 반응 → 칩 줄 ＋, 내 반응만 있던 칩 취소) 같은 코멘트의 반응 컨트롤로 포커스를 잇는다(WP-830).
  const itemRef = useRef<HTMLLIElement>(null);
  useReactionFocusRestore(itemRef, comment.reactions);

  // 수정 저장 — PATCH 호출 후 편집 모드 종료. 실패 시 편집 모드 유지 + 입력 보존(RichInput reject 처리).
  const handleSave = async (body: string) => {
    try {
      await update.mutateAsync({ commentId: comment.id, data: { body } });
      setEditing(false);
      toast.success('코멘트를 수정했습니다');
    } catch (e) {
      handleApiError(e, '코멘트 수정에 실패했습니다');
      throw e;
    }
  };

  // 삭제 확인 후 DELETE 호출.
  const handleDelete = async () => {
    try {
      await remove.mutateAsync(comment.id);
      toast.success('코멘트를 삭제했습니다');
    } catch (e) {
      handleApiError(e, '코멘트 삭제에 실패했습니다');
    }
  };

  // 미리보기는 이미지 마크다운을 '[이미지]' 로 줄여 보여 준다 — 긴 URL 이 20자를 다 차지하지 않게(WP-362).
  // 멘션 토큰 <@id> 는 본문 칩과 같은 이름표로 「@이름」 평문으로 바꾼다 — 확인 창에 토큰 원문이 보이지 않게(WP-1134).
  const preview = messagePlainText(withImagePlaceholders(comment.body, projectKey), commentMentionUsers);
  const itemName = preview.slice(0, 20) + (preview.length > 20 ? '…' : '');
  // 코멘트에 넣은 이미지도 지워질 수 있다는 안내 — 본문·다른 코멘트에서도 쓰는 이미지는 서버가 남기므로 조건을 함께 적는다.
  const imageCount = countApiImages(comment.body, projectKey);
  const deleteDescription =
    imageCount > 0
      ? `"${itemName}" 코멘트를 정말 삭제하시겠습니까? 코멘트에 넣은 이미지 ${imageCount}개도 본문이나 다른 코멘트에서 쓰지 않으면 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
      : undefined;
  // AGENT 코멘트 마크다운의 이미지 렌더러 — MarkdownMessage 가 이 함수로 img 컴포넌트를 memo 하므로 렌더마다 새로 만들지 않는다
  // (새로 만들면 이미지가 리마운트돼 열린 뷰어가 닫히고 썸네일이 다시 깜빡인다).
  const renderImage = useCallback(
    (p: { src?: string; alt?: string }) => <IssueBodyImage projectKey={projectKey} {...p} />,
    [projectKey],
  );
  // 멘션 토큰 <@id> → 이슈 채팅과 같은 칩 — AI 는 AI 색, 사람은 중립색(#785, #208). 토큰 나누기는 MarkdownMessage 가 채팅 AI 글과 같은
  // 규칙으로 한다(WP-1009) — 코드(`…`·펜스) 안의 토큰은 칩으로 바꾸지 않고 글자 그대로 둔다. 예전에는 토큰을 마크다운 링크로 미리 바꿔
  // 넣어, 코드 안에서는 그 링크 원문(「[@이름](#comment-mention-2)」)이 그대로 보였다(WP-1093).
  const renderMention = useCallback<RenderMention>(
    (seg, key) => <IssueMentionChip key={key} seg={seg} testId={`comment-mention-chip-${seg.id}`} />,
    [],
  );

  return (
    <li
      ref={itemRef}
      // min-w-0 — 카드가 flex/grid 자식일 때 긴 내용이 카드 폭을 밀어내지 않게(WP-228).
      // 머리 띠 카드(WP-1034) — overflow-hidden 은 쓰지 않는다: 터치 ⋯(44px)의 위쪽 탭 영역·초점 링이 카드 가장자리에서 잘린다(띠는 rounded-t-md 로 둥글린다).
      // 링크로 열어 온 코멘트는 잠시 강조 링(WP-1175) — 링이 사라질 때 천천히 빠지게 transition.
      className={cn(
        'relative group min-w-0 rounded-md border bg-card transition-shadow duration-700 motion-reduce:transition-none',
        isAgent && 'border-ai-accent/50',
        highlighted && 'ring-2 ring-primary',
      )}
      data-highlighted={highlighted ? 'true' : undefined}
      data-agent={isAgent ? 'true' : undefined}
      // 목록의 길게 누르기 위임(useMessageListLongPress)이 칩이 속한 코멘트를 찾는 표식(WP-504).
      data-message-id={comment.id}
      // 코멘트 링크의 조각(#comment-<id>)과 같은 id — 링크로 열면 목록이 이 행으로 스크롤한다(WP-1175).
      id={`comment-${comment.id}`}
    >
      {/* 머리 띠: 아바타 + 굵은 작성자 + 날짜 + (본인 코멘트) 수정·삭제(WP-1034) — 같은 사람이 연달아 써도 띠마다 끊긴다. 모바일은 여백만 줄인다. */}
      <div
        data-testid={`issue-comment-header-${comment.id}`}
        className={cn(
          'flex items-center justify-between gap-1 rounded-t-md border-b px-2.5 py-1 md:px-3 md:py-1.5',
          isAgent ? 'border-ai-accent/30 bg-ai-accent-subtle' : 'bg-muted/60',
        )}
      >
        {/* 긴 작성자명이 날짜·⋯ 를 밀어내지 않게 — 래퍼가 남은 폭만 쓰고(min-w-0 flex-1) 이름만 말줄임,
            아바타·AI 배지·날짜는 줄지도 꺾이지도 않는다(WP-228). */}
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {/* 이슈 채팅 머리 줄과 같은 ChatAvatar — 이니셜·사람 색·AI 봇 표식, 이름이 옆에 있어 장식(aria-hidden)이다.
              아바타·이름을 누르면 사람 카드(WP-1767) — 이름만 말줄임되게 트리거가 남은 폭을 나눠 쓴다(min-w-0). */}
          <PersonCardTrigger
            person={{ id: comment.authorId, name: comment.authorName, kind: comment.authorKind }}
            className="inline-flex min-w-0 items-center gap-2"
          >
            <ChatAvatar userId={comment.authorId} name={comment.authorName} kind={comment.authorKind} className="size-6 shrink-0 text-xs" />
            <span className="min-w-0 truncate font-semibold text-foreground hover:underline">{comment.authorName}</span>
          </PersonCardTrigger>
          {isAgent && (
            // AI 배지 변형(테두리 있음) + 카드 바탕 — AI 옅은 색 띠 위에서도 배지 모양이 묻히지 않는다.
            <Badge variant="ai" className="shrink-0 bg-card">
              AI
            </Badge>
          )}
          {/* parseUtcDate 를 내장한 formatDateTimeMinute 로 UTC→로컬 변환 + 분 단위 표시 (#320) */}
          <span data-testid={`issue-comment-time-${comment.id}`} className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {formatDateTimeMinute(comment.createdAt)}
          </span>
        </div>

        {/* 헤더 오른쪽 hover 액션 — 반응 추가(반응 없는 코멘트) + 링크 복사(모든 코멘트, WP-1175) + 본인 HUMAN 코멘트의 수정·삭제(터치는 ⋯ 메뉴) */}
        <div className="flex shrink-0 items-center gap-1">
          {headerReactionAdd && (
            <AddReactionButton
              commentId={comment.id}
              variant="header"
              onPick={toggleReaction}
            />
          )}
          {!editing && (touch ? (
            // 44px 터치 영역이 헤더 줄 높이를 키우지 않도록 음수 마진으로 시각 크기만 유지(DrivePage 행 ⋮ 와 동일).
            <TouchRowActionsMenu
              title="코멘트"
              ariaLabel="코멘트 더보기"
              testId={`issue-comment-more-${comment.id}`}
              sheetTestId="issue-comment-sheet"
              itemTestId={(key) => `issue-comment-action-${key}`}
              triggerClassName="-my-3 -mr-2"
              actions={commentActions}
            />
          ) : (
            // 키보드 포커스가 들어와도 보이게(focus-within) — 수정 뒤 포커스가 이 버튼으로 돌아온다(WP-813).
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="코멘트 링크 복사"
                title="코멘트 링크 복사"
                onClick={copyLink}
                data-testid={`issue-comment-copy-link-${comment.id}`}
              >
                <Link2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="코멘트 링크를 채팅·이슈로 보내기"
                title="채팅·이슈로 보내기"
                onClick={sendLink}
                data-testid={`issue-comment-send-${comment.id}`}
              >
                <MessageSquareShare className="h-3.5 w-3.5" />
              </Button>
              {isOwn && (
              <>
              <Button
                ref={editButtonRef}
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="코멘트 수정"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <DeleteConfirmDialog
                entityName="코멘트"
                itemName={itemName}
                description={deleteDescription}
                onConfirm={handleDelete}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    aria-label="코멘트 삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                }
              />
              </>
              )}
            </div>
          ))}
        </div>
      </div>

      {isOwn && touch && (
        <DeleteConfirmDialog
          entityName="코멘트"
          itemName={itemName}
          description={deleteDescription}
          onConfirm={handleDelete}
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
        />
      )}

      {/* 본문: 편집 모드면 인라인 RichInput(@멘션), 아니면 멘션 칩 포함 텍스트 */}
      <div className="px-2.5 py-1.5 md:px-3 md:py-2">
        {editing ? (
          <RichInput
            ariaLabel="코멘트 수정"
            members={mentionCandidates}
            initialBody={comment.body}
            initialMentions={commentMentionUsers}
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
            submitLabel="저장"
            // 내용을 비우면 「저장」을 막는다 — 활성인데 눌러도 아무 반응이 없었다(WP-1552). 새 코멘트 입력과 같은 규칙.
            disableWhenEmpty
            maxLength={ISSUE_BODY_MAX_LENGTH}
            overLimitMessage={commentOverLimitMessage}
            autoFocus
            inputTestId="issue-comment-edit-input"
            submitTestId="issue-comment-edit-save"
            cancelTestId="issue-comment-edit-cancel"
            // WP-362: 기존 이미지는 원래 자리에 썸네일로 복원되고, 새로 붙여넣을 수도 있다.
            imageUpload={(file) => uploadIssueImage(projectKey, file)}
          />
        ) : (
          /* WP-254·WP-1015: 사람·AI 코멘트 모두 마크다운(제목·굵게·목록·표·코드·링크)으로 렌더 — 웹 입력과 MCP·API 원문이 같은 모습이다
             (이슈 채팅 ChatMessageRow 와 동일 패턴). 원시 HTML 은 여전히 비허용. 한 줄 개행은 p 의 pre-wrap 이 보존하므로 평문 코멘트는 이전과 같게 보인다.
             whitespace-pre-wrap 은 빼야 한다 — 블록 사이 개행 텍스트 노드가 빈 줄로 보인다(p 가 자체로 줄바꿈 보존). */
          <MarkdownMessage
            className="leading-6 text-foreground"
            renderImage={renderImage}
            mentions={commentMentionUsers}
            renderMention={renderMention}
            // 평문 이슈 키(「WP-12」)는 이슈 링크 + 미리보기(WP-1237) — 보이는 프로젝트의 키만.
            renderIssueRef={renderIssueKeyRef}
          >
            {comment.body}
          </MarkdownMessage>
        )}

        {/* 앱 링크 카드(WP-1235) — 「채팅·이슈로 보내기」로 이슈 댓글에 보낸 링크가 채팅과 같은 카드로 보이게. 편집 중엔 숨긴다. */}
        {!editing && <CommentAppLinkCards commentId={comment.id} body={comment.body} />}

        {/* 이모지 반응(WP-504) — 본문 아래 칩 줄. 편집 중엔 숨긴다(편집창 아래 칩·버튼이 섞이지 않게). */}
        {!editing && (
          <CommentReactions
            comment={comment}
            issueId={issueId}
            canReact={canReact}
            touch={touch}
            currentUserId={currentUserId}
            onOpenReactors={openReactorsForComment}
            onToggle={toggleReaction}
          />
        )}
      </div>
    </li>
  );
});

/**
 * 코멘트 본문의 우리 앱 링크 카드(WP-1235) — 채팅 메시지와 같은 규칙(appLinksOf: 앞에서 3개, 같은 대상은 하나)·같은 묶음(LinkPreviewList).
 * 코드 블록·인라인 코드 안 주소는 카드로 만들지 않는다(코드로 적은 예시 주소). 외부 링크(OG) 카드는 댓글에 없어 앱 카드만 넘긴다.
 * 카드는 보는 사람 권한으로 채운다(볼 수 없는 대상은 「볼 수 없는 …」). testid 는 메시지 카드와 겹치지 않게 comment-app-link 접두를 쓴다.
 */
function CommentAppLinkCards({ commentId, body }: { commentId: number; body: string }) {
  const appHosts = useAppHosts();
  const links = appLinksOf(withoutMarkdownCode(body), appHosts);
  return <LinkPreviewList messageId={commentId} previews={[]} appLinks={links} testIdPrefix="comment-app-link" />;
}

/** 댓글 입력이 잠겼을 때 입력 대신 보이는 안내(WP-1495) — 데스크톱 목록 아래와 모바일 하단 막대가 함께 쓴다(문구 한 곳). */
export function CommentLockedNotice() {
  return (
    <p className="text-sm text-muted-foreground" data-testid="comment-locked-notice">
      이 프로젝트 멤버만 댓글을 달 수 있어요
    </p>
  );
}

// 코멘트 목록을 고른 순서(WP-1016)로 표시하고, 작성창에서 신규 코멘트를 추가.
// 작성창은 새 코멘트가 붙는 쪽에 둔다 — 오래된 순이면 목록 아래, 최신순이면 목록 위(새 글이 작성창 바로 옆에 붙어 스크롤이 필요 없다).
/** 코멘트를 모두 지웠을 때 포커스를 받을 작성칸 — 데스크톱은 목록 위·아래, 모바일(WP-196)은 화면 하단 줄에 하나만 그려진다. */
function commentComposerInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="issue-comment-input"]');
}

/** 링크로 열어 온 코멘트를 강조해 두는 시간 — 스크롤이 끝나고 눈이 닿을 만큼. */
export const LINKED_COMMENT_HIGHLIGHT_MS = 4000;

// 렌더 윈도우(WP-2073) — 코멘트가 200개면 한 번에 전부 그려 LCP·INP 가 늘어난다.
// 처음 30건만 그리고 「더 보기」를 누를 때마다 30건씩 더 그린다.
/** 처음 그려 넣는 코멘트 수. */
const INITIAL_VISIBLE_COMMENTS = 30;
/** 「더 보기」 한 번에 늘려 그리는 코멘트 수. */
const MORE_VISIBLE_COMMENTS = 30;

/**
 * 렌더 윈도우 밖 대상(WP-2073) — 목록에는 있는데 아직 안 그려진 코멘트인지 판정한다.
 *
 * 방금 쓴 코멘트 스크롤·링크로 온 코멘트 두 효과가 같은 판정을 쓴다 — 그대로 두면
 * 「찾을 수 없습니다」 오인·아무 일도 없는 스크롤로 끝나므로, 참이면 그 자리까지 창을 늘려야 한다(WP-2073 리뷰 후속 ⑤).
 * 렌더 바깥 함수라 효과 의존성(ordered·visibleCount) 을 그대로 두고 써도 참조가 흔들리지 않는다.
 */
const isHiddenByWindow = (id: number, ordered: readonly IssueCommentResponse[], visibleCount: number) =>
  visibleCount < ordered.length && ordered.some((c) => c.id === id);

/**
 * 대상 코멘트가 창 안에 들어오도록 필요한 창 크기(WP-2073 리뷰 후속 ⑤) — 목록에 있으면 그 자리까지만,
 * 30단위(한 번에 늘리는 양)로 올린 값이고, 목록에 없으면 null.
 *
 * 예전에는 창 밖 대상을 만나면 `전부 펼침`(MAX_SAFE_INTEGER)으로 200행을 한 번에 그려, 이슈 상세가
 * 이 이슈가 고치려던 성능 문제(일괄 렌더)로 되돌아갔다. 대상까지만 올리면 30건씩 늘어난 결과와 같아
 * 다른 곳에서 「더 보기」로 펼친 결과와도 겹친다(창은 늘 연속 구간이라).
 * 렌더 바깥 함수라 두 효과(스크롤·링크) 가 참조해도 exhaustive-deps 가 깨지지 않는다(위 isHiddenByWindow 와 같은 이유).
 */
const visibleCountFor = (
  id: number,
  ordered: readonly IssueCommentResponse[],
  order: ActivityOrder,
  visibleCount: number,
): number | null => {
  const pos = ordered.findIndex((c) => c.id === id);
  if (pos < 0) return null;
  // 오래된 순은 창이 뒤쪽(최신)을 쥐므로 남은 개수, 최신순은 앞쪽을 쥐므로 위치+1 이 곧 필요한 크기다.
  const required = order === 'newest' ? pos + 1 : ordered.length - pos;
  // 30단위로 올리되 목록 길이를 넘지 않는다 — 창이 목록보다 커질 일이 없음을 코드로 드러낸다(렌더는 slice 가 받아쳐 준다).
  const rounded = Math.min(Math.ceil(required / MORE_VISIBLE_COMMENTS) * MORE_VISIBLE_COMMENTS, ordered.length);
  return Math.max(visibleCount, rounded);
};

/**
 * 창의 **오래된 쪽 경계**가 가리키는 코멘트 id(WP-2073 리뷰 후속 ①~③) — 보이는 행 중 가장 오래된 것이다.
 *
 * `comments` 는 늘 오래된 순이라 창(오래된 쪽을 숨기고 최신 쪽을 보여 준다)의 경계는 `length - visibleCount`
 * 자리에 있다. 목록 길이가 아니라 이 id 로 창을 다시 맞추기 위해 쓴다 — 길이로만 맞추면 숨은 영역의 코멘트가
 * 지워질 때 경계가 한 칸 밀려 읽던 행이 사라지고(리뷰 후속 ①·③) 초점이 위 행으로 간다(②·WP-832).
 * 창이 목록보다 크거나 같으면(전부 보이는 상태) 경계는 가장 오래된 코멘트다.
 */
const oldestVisibleId = (comments: readonly IssueCommentResponse[], visibleCount: number): number | null => {
  const first = comments[0];
  if (first == null) return null;
  const index = comments.length - visibleCount;
  return index <= 0 ? first.id : (comments[index]?.id ?? first.id);
};

export function IssueCommentList({
  projectKey,
  issueNumber,
  issueId,
  comments,
  canReact,
  hideComposer = false,
  commentLocked = false,
  order = DEFAULT_ACTIVITY_ORDER,
  scrollToCommentId = null,
  onScrolledToComment,
  linkedCommentId = null,
  onLinkedCommentHandled,
  onBodyPosted,
}: {
  projectKey: string;
  issueNumber: number;
  issueId: number;
  comments: IssueCommentResponse[];
  /** 코멘트 이모지 반응 추가·취소 가능 여부 — 이슈 상세의 viewerCanEditContent(WP-504). */
  canReact: boolean;
  /** 모바일(WP-196)은 작성창을 화면 하단 줄에 따로 두므로 목록 아래 작성창을 뺀다(testid 중복 방지). */
  hideComposer?: boolean;
  /** 댓글 권한이 없을 때(WP-1495) — 참이면 작성창 대신 안내를 그린다. */
  commentLocked?: boolean;
  /** 보이는 순서(WP-1016) — comments 는 늘 오래된 순으로 받는다. */
  order?: ActivityOrder;
  /** 모바일 하단 작성창으로 방금 쓴 코멘트 id — 목록에 나타나면 그리로 스크롤한다(WP-1016). */
  scrollToCommentId?: number | null;
  /** scrollToCommentId 로 스크롤을 마쳤다 — 부모가 id 를 비운다(같은 코멘트로 다시 스크롤하지 않게). */
  onScrolledToComment?: () => void;
  /** 코멘트 링크(#comment-<id>)로 열어 온 코멘트 — 그리로 스크롤하고 잠시 강조한다. 없으면(삭제됨) 알린다(WP-1175). */
  linkedCommentId?: number | null;
  /** linkedCommentId 를 처리했다(찾았든 못 찾았든) — 부모가 id 를 비운다. */
  onLinkedCommentHandled?: () => void;
  /** 새 코멘트를 올렸다(본문) — 워크플로우 배너의 「답으로 보내기」용(WP-1989). */
  onBodyPosted?: (body: string) => void;
}) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;
  const isCoarse = useIsCoarsePointer();
  const isMobile = useIsMobile();
  const touch = isMobile || isCoarse;

  // 반응자 전체 보기(WP-504) — 목록당 하나(채팅 MessageList 와 같은 구조). 데스크톱은 호버 카드의 모두 보기, 터치는 칩 길게 누르기가 연다.
  // 대상은 코멘트 id 로만 들고 최신 목록에서 찾는다(열린 동안 개수 실시간 반영). 닫을 때 대상은 남겨 닫힘 애니메이션 동안 내용이 비지 않게 한다.
  const [reactors, setReactors] = useState<{ id: number; emoji: string; open: boolean } | null>(null);
  // comments 는 반응 토글·수정·삭제 때 detail 쿼리가 무효화돼 매번 새 참조로 온다(구조적 공유라 실제로 바뀐 행은 하나여도) —
  // 콜백 의존성에 두면 콜백 참조가 바뀌어 윈도우 안 모든 행의 memo 가 무력화된다. 최신 목록은 ref 로 읽어
  // 코멘트 존재 가드는 그대로 두고 콜백 참조는 완전히 고정한다(WP-2073).
  const commentsRef = useRef(comments);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);
  const openReactors = useCallback((id: number, emoji: string) => {
    if (commentsRef.current.some((c) => c.id === id)) setReactors({ id, emoji, open: true });
  }, []);
  const reactorsComment = reactors ? comments.find((c) => c.id === reactors.id) : undefined;
  // 반응이 모두 사라지거나 코멘트가 지워져 오버레이가 숨겨지면 open 도 내린다 — 그대로 두면 나중에 반응이 다시 달릴 때
  // 사용자 조작 없이 저절로 다시 열린다. 렌더 중 상태 조정(효과로 미루면 한 프레임 다시 열린 상태가 그려질 수 있다).
  if (reactors?.open && !reactorsComment?.reactions?.length) setReactors({ ...reactors, open: false });
  // 터치에서 칩을 길게 누르면 반응자 시트 — 코멘트 행 자체의 길게 누르기 작업 시트는 없다(canOpen=false, 네이티브 메뉴 유지).
  const longPress = useMessageListLongPress(touch, () => false, () => {}, openReactors);
  // 코멘트를 키보드로 지우면 행이 빠지며 포커스가 body 로 빠졌다 — 같은 자리에 온 코멘트로, 다 지웠으면 작성칸으로 잇는다(WP-832).
  const listRef = useListFocusRescue(comments, commentComposerInput);

  // 렌더 윈도우(WP-2073) — 처음 30건만 그리고 「더 보기」를 누를 때마다 30건씩 늘린다.
  // 코멘트가 200개여도 한 번에 전부 그리면 LCP·INP 늘어난다.
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE_COMMENTS);
  // 이슈가 바뀌면 렌더 윈도우를 처음으로 되돌린다 — 앞 이슈에서 펼쳐 둔 창이 다음 이슈로 새면 목록 전체를 다시 그린다(WP-2073).
  // 상세 쿼리가 캐시에 있으면 로딩 화면이 없어 리스트 인스턴스가 그대로 유지되므로(재마운트 없음) 렌더 중에 맞춘다.
  const [prevIssueId, setPrevIssueId] = useState(issueId);
  // 창의 **오래된 쪽 경계**(숨은 코멘트)를 고정한다(WP-2073 리뷰 후속 ①~③) — 목록 길이가 아니라 경계가
  // 가리키는 **코멘트 id** 로 창을 다시 맞춘다. 경계가 움직이면
  // ① 오래된 쪽 행을 편집하는 중 새 코멘트가 오면 그 행이 창 밖으로 밀려 언마운트되고(작성 중 내용이 사라진다)
  // ② 삭제 뒤 숨은 코멘트가 경계 위로 끼어들어 useListFocusRescue(DOM 인덱스)가 한 칸 위 행으로 초점을 옮긴다(WP-832 회귀)
  // ③ 읽던 맨 위 행이 새 코멘트마다 사라진다.
  // 늘어나는 쪽(최신)은 새 코멘트가 창에 그대로 더해지고, 줄어드는 쪽은 지워진 행만큼만 줄어 숨은 것은 그대로 숨는다.
  const [prevCommentCount, setPrevCommentCount] = useState(comments.length);
  // 지난 렌더의 경계 id — 목록이 바뀐 지금 그 id 가 어디 있는지로 창 크기를 계산한다(값이 같으면 React 이 다시 그리지 않는다).
  const [prevAnchorId, setPrevAnchorId] = useState<number | null>(() => oldestVisibleId(comments, INITIAL_VISIBLE_COMMENTS));
  // 이번 렌더에 적용할 창 크기 — 목록이 바뀔 때만 고친다(사용자의 「더 보기」·창 확장 효과는 그대로 둔다).
  let nextVisibleCount = visibleCount;
  if (prevIssueId !== issueId) {
    nextVisibleCount = INITIAL_VISIBLE_COMMENTS;
    setPrevIssueId(issueId);
    setPrevCommentCount(comments.length);
    setVisibleCount(nextVisibleCount);
  } else if (prevCommentCount !== comments.length) {
    const anchorIndex = prevAnchorId == null ? -1 : comments.findIndex((c) => c.id === prevAnchorId);
    if (anchorIndex >= 0) {
      // 경계 코멘트가 아직 목록에 있으면 그 자리부터 다시 그린다 — 추가·삭제 어느 쪽이든 경계가 밀리지 않는다.
      nextVisibleCount = comments.length - anchorIndex;
    } else {
      // 경계 코멘트 자신이 지워진 경우(또는 아직 목록이 비어 있을 때) — 숨은 개수를 그대로 유지한다.
      const grown = visibleCount + (comments.length - prevCommentCount);
      // 창이 목록 길이보다 앞서면(대량 삭제) 전부 보여 준다 — 창이 비는 것을 막는다.
      nextVisibleCount = grown <= 0 ? comments.length : Math.min(grown, comments.length);
    }
    setPrevCommentCount(comments.length);
    setVisibleCount(nextVisibleCount);
  }
  // 경계 id 동기화(파생 상태) — 「더 보기」·창 확장 효과가 창을 늘린 뒤에도 경계를 따라가게 한다.
  const anchorId = oldestVisibleId(comments, nextVisibleCount);
  if (prevAnchorId !== anchorId) setPrevAnchorId(anchorId);

  // 화면 순서(WP-1016) — comments 는 늘 오래된 순으로 오고 order 만 뒤집는다(원본은 뒤집지 않는다).
  // 아래 두 효과(방금 쓴 코멘트 스크롤·링크로 온 코멘트)가 이 값에 의존하므로 목록 맵보다 위에서 계산하고,
  // useMemo 로 참조를 고정한다 — order='newest' 면 orderActivity 가 매 렌더 새 배열을 만들어 효과 의존성이 흔들린다(WP-2073).
  const ordered = useMemo(() => orderActivity(comments, order), [comments, order]);

  // 작성 성공 콜백은 그대로 넘긴다(WP-2073 리뷰 ②) — 렌더 윈도우가 늘 최신 쪽을 잡으므로(아래 `windowed`)
  // 방금 쓴 코멘트(가장 최신)는 어느 정렬에서도 창 안에 들어온다. 예전에는 여기서 전부 펼쳐, 작성할 때마다
  // 200행을 다시 그려 INP 가 늘었다. 혹시 창 밖에 남으면 아래 스크롤 효과가 그때만 대상까지 늘린다.
  const handleBodyPosted = useCallback(
    (body: string) => {
      onBodyPosted?.(body);
    },
    [onBodyPosted],
  );

  // 방금 쓴 코멘트로 스크롤(WP-1016 리뷰) — 모바일 작성창은 화면 하단에 고정이라, 새 코멘트가 목록 어디에 붙든
  // (최신순 맨 위·오래된 순 맨 끝) 읽던 자리에서는 올라갔는지 보이지 않는다. 작성 성공이 알려 준 id 로만 움직인다 —
  // 다른 곳(다른 탭·AI)에서 온 코멘트는 읽던 자리를 빼앗지 않는다. 다시 받은 목록에 아직 없으면 다음 갱신에서 다시 본다.
  // 가운데로 맞춰 상단 고정 헤더·하단 작성창에 가리지 않게 하고, 움직임 줄이기 설정이면 바로 옮긴다.
  const sectionRef = useRef<HTMLElement>(null);
  const rowOf = (id: number) => sectionRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  useEffect(() => {
    const row = scrollToCommentId == null ? null : rowOf(scrollToCommentId);
    if (!row) {
      // 윈도우 밖이면 대상까지만 늘린다 — 그대로 두면 아무 일도 없는 스크롤로 끝난다(WP-2073).
      // ordered·visibleCount 가 의존성에 있어야 늘린 뒤 효과가 다시 돈다.
      if (scrollToCommentId != null && isHiddenByWindow(scrollToCommentId, ordered, visibleCount)) {
        const need = visibleCountFor(scrollToCommentId, ordered, order, visibleCount);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- 대상까지만 늘린 뒤 같은 효과가 다시 돌아 대상을 찾는다(의도된 한 번의 연쇄 렌더).
        if (need != null) setVisibleCount(need);
      }
      return;
    }
    scrollIntoViewCentered(row);
    onScrolledToComment?.();
  }, [scrollToCommentId, comments, onScrolledToComment, ordered, order, visibleCount]);

  // 코멘트 링크로 열어 온 코멘트(WP-1175) — 목록은 이슈 상세와 함께 한 번에 오므로(접기·페이지 없음) 부모가 최신 상세를 받은 뒤
  // 넘겨 준 id 는 그 목록에 있거나 없거나다. 있으면 가운데로 스크롤하고 잠시 강조, 없으면 지워졌을 수 있다고 알린다.
  // 처리한 뒤 부모가 id 를 비워 다시 움직이지 않는다. 안내 토스트는 id 로 하나만 띄운다(개발 모드에서 효과가 두 번 돌아도).
  const [highlightId, setHighlightId] = useState<number | null>(null);
  // 링크 처리는 링크 하나당 한 번만(WP-2073 리뷰 ⑤) — 아래 효과의 의존성에 ordered·visibleCount 가 있어
  // 목록 갱신·창 확장 때마다 다시 돌아, 부모가 id 를 비우기 전에 스크롤·강조·안내가 겹쳐 실행됐다.
  // 같은 id 로 다시 돌아오면 건너뛰고, 링크가 비워지면 다음 링크를 위해 표시를 지운다.
  const handledLinkedRef = useRef<number | null>(null);
  useEffect(() => {
    if (linkedCommentId == null) {
      handledLinkedRef.current = null;
      return;
    }
    if (handledLinkedRef.current === linkedCommentId) return;
    const row = rowOf(linkedCommentId);
    if (row) {
      handledLinkedRef.current = linkedCommentId;
      scrollIntoViewCentered(row);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 행이 그려진 DOM 을 찾은 뒤에야 강조할지 알 수 있어 렌더 중으로 못 옮긴다(링크마다 한 번).
      setHighlightId(linkedCommentId);
    } else if (isHiddenByWindow(linkedCommentId, ordered, visibleCount)) {
      // 「찾을 수 없습니다」 로 오인하지 않도록 대상까지만(30단위 올림) 늘리고 그 자리에서 돌아간다 —
      // 전부 펼치면 200행이 한 번에 다시 그려져 이 이슈가 없애려던 성능 문제가 되돌아온다(WP-2073 리뷰 후속 ⑤).
      // 처리 완료도 알리지 않는다(늘린 뒤 다음 렌더에서 다시 찾는다).
      const need = visibleCountFor(linkedCommentId, ordered, order, visibleCount);
      if (need != null) setVisibleCount(need);
      return;
    } else {
      // 목록에 아예 없는 id(삭제됨) — 지금처럼 알리고 처리를 끝낸다.
      handledLinkedRef.current = linkedCommentId;
      toast.info('링크한 코멘트를 찾을 수 없습니다 — 삭제됐을 수 있습니다', { id: 'issue-comment-link-missing' });
    }
    onLinkedCommentHandled?.();
  }, [linkedCommentId, onLinkedCommentHandled, ordered, order, visibleCount]);
  useEffect(() => {
    if (highlightId == null) return;
    const t = setTimeout(() => setHighlightId(null), LINKED_COMMENT_HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightId]);

  // 프로젝트 멤버 = RichInput @ 자동완성 후보이자, 본문 <@id> 토큰의 이름/종류 역매핑 소스.
  const membersQuery = useProjectMembers(projectKey);
  const mentionCandidates: MentionCandidate[] = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  // 멤버가 바뀔 때만 새로 만든다 — MarkdownMessage 가 mentions 로 렌더러 묶음을 다시 만들면 코멘트 이미지가 다시 마운트돼
  // 열린 뷰어가 닫히고 썸네일이 깜빡인다(renderImage 를 memo 하는 이유와 같다).
  const mentionUsers: MentionUser[] = useMemo(
    () => mentionCandidates.map(toMentionUser),
    [mentionCandidates],
  );

  const composer = !hideComposer && (
    <div key="composer" className="space-y-2">
      {commentLocked
        ? <CommentLockedNotice />
        : <IssueCommentComposer projectKey={projectKey} issueNumber={issueNumber} issueId={issueId} onBodyPosted={handleBodyPosted} />}
    </div>
  );

  // 지금 그릴 코멘트(WP-2073 리뷰 ①) — 렌더 윈도우는 어느 정렬이든 최신 쪽을 잡는다.
  // 오래된 순(기본)에서 앞쪽을 슬라이스하면 30건 창이 가장 오래된 댓글만 담아 최신 댓글·AI 보고가 가려진다 —
  // 오래된 순은 뒤쪽(최신 30건), 최신순은 앞쪽(최신 30건)을 그려 둘 다 최신이 처음 보인다.
  const windowed =
    ordered.length <= visibleCount
      ? ordered
      : order === 'newest'
        ? ordered.slice(0, visibleCount)
        : ordered.slice(ordered.length - visibleCount);
  // 아직 안 그린 코멘트 수 — 「더 보기」 버튼 문구와 버튼 표시 여부를 정한다(숨은 것은 늘 더 오래된 쪽).
  const hiddenCount = ordered.length - windowed.length;

  // 「더 보기」 클릭(WP-2073) — 30건씩 늘려 그린다. 남은 개수가 끝나는 마지막 클릭은 버튼이 이번 렌더에서
  // 사라지므로 초점 이동까지 여기서 함께 처리한다.
  const showMoreComments = () => {
    const nextCount = visibleCount + MORE_VISIBLE_COMMENTS;
    // 남은 개수가 0이 되는 마지막 클릭 — 버튼이 이번 렌더에서 사라져 초점을 가진 컨트롤이 없어진다
    // (document.activeElement → body, 다음 Tab 이 페이지 맨 위에서 시작: WCAG 2.4.3). useListFocusRescue 는
    // 버튼이 <ul> 밖에 있고 목록도 그대로라 잡지 못하므로, 확장 전에 막 드러날 첫 행 id 를 정해 두고
    // 그려진 뒤 그 행으로 초점을 옮긴다(WP-2073 리뷰 ④ — 이미 보이던 마지막 행이 아니라 새로 드러난 첫 행).
    // 오래된 순은 위쪽에, 최신순은 아래쪽에 늘어나므로 새로 드러난 행들 중 화면 순서의 첫째를 고른다.
    const firstRevealed = order === 'newest' ? visibleCount : Math.max(0, ordered.length - nextCount);
    const focusTargetId = nextCount >= ordered.length ? ordered[firstRevealed]?.id : undefined;
    // DOM 이 갱신된 뒤에 초점을 옮기려면 상태 변경을 동기로 흘려야 한다 — 이벤트가 끝나기 전에 행이 그려진다.
    flushSync(() => setVisibleCount(nextCount));
    if (focusTargetId == null) return;
    // 마우스로 눌렀어도 다른 곳으로 초점이 이미 옮겨 갔으면 빼앗지 않는다 — 버튼이 사라지며 초점을 잃었을 때만.
    const active = document.activeElement;
    if (active != null && active !== document.body && active.isConnected) return;
    const row = rowOf(focusTargetId);
    if (row) focusRow(row);
    else commentComposerInput()?.focus({ preventScroll: true });
  };

  // 「더 보기」 단추 — 숨은 코멘트는 늘 더 오래된 쪽이라, 오래된 순(기본)의 창은 위쪽(최신)을 쥐고
  // 아래로 늘어나는 게 아니라 위로 늘어난다 — 단추를 늘어나는 쪽(목록 위)에 둬야 새로 드러난 첫 행이 바로 옆이다.
  // 최신순은 아래로 늘어나니 지금처럼 목록 아래에 둔다(WP-2073 리뷰 ①·④).
  // 문구(WP-2073 리뷰 후속 ④)는 누르면 실제로 늘어나는 수(한 번에 30건, 남은 개수보다 적으면 남은 만큼)와
  // 그 뒤에도 남는 수를 함께 적는다 — 「댓글 40개 더 보기」처럼 누르면 늘어나는 30건보다 큰 수를 쓰면
  // 눌러 보고 10건만 늘어나 글자가 틀린 것처럼 보인다.
  const revealCount = Math.min(MORE_VISIBLE_COMMENTS, hiddenCount);
  const moreButton = hiddenCount > 0 && (
    <div className="flex justify-center">
      <Button variant="outline" size="sm" data-testid="issue-comment-more" onClick={showMoreComments}>
        이전 댓글 {revealCount}개 더 보기(남은 {hiddenCount - revealCount}개)
      </Button>
    </div>
  );

  // "코멘트" 레이블 제거 — 상위 탭(코멘트)이 이미 맥락 제공(중복 제거).
  const list = (
    <Fragment key="list">
      {order === 'newest' ? null : moreButton}
      <ul ref={listRef} className="space-y-3" role="list" {...longPress}>
        {windowed.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            // 본인 HUMAN 코멘트만 수정·삭제 가능
            isOwn={c.authorKind === 'HUMAN' && user != null && c.authorId === user.id}
            projectKey={projectKey}
            issueNumber={issueNumber}
            issueId={issueId}
            mentionUsers={mentionUsers}
            mentionCandidates={mentionCandidates}
            canReact={canReact}
            touch={touch}
            currentUserId={currentUserId}
            // 목록의 openReactors 는 useCallback 안정 참조 — 맵에서 감싸면 매 렌더 새 클로저가 되어 memo 가 무력화된다(WP-2073).
            // id 묶음은 각 행 CommentItem 안에서만 한다.
            onOpenReactors={openReactors}
            highlighted={c.id === highlightId}
          />
        ))}
        {comments.length === 0 && (
          <li className="text-muted-foreground text-sm">코멘트가 없습니다</li>
        )}
      </ul>
      {/* 「더 보기」(WP-2073) — <ul> 밖(섹션 안)에 둬 행으로 세지 않게 한다. */}
      {order === 'newest' ? moreButton : null}
    </Fragment>
  );

  return (
    <section ref={sectionRef} aria-label="코멘트" className="space-y-3">
      {/* 순서를 바꿔도 작성창·목록을 키로 옮기기만 한다 — 다시 마운트하면 쓰던 초안이 날아간다. */}
      {order === 'newest' ? [composer, list] : [list, composer]}
      <ReactorsOverlay
        target={reactorsComment && { id: reactorsComment.id, reactions: reactorsComment.reactions ?? [] }}
        // 대상이 없으면 패널을 그리지 않아 조회도 없다 — id 0 은 자리 채움.
        source={commentReactorSource(issueId, reactors?.id ?? 0)}
        initialEmoji={reactors?.emoji ?? ''}
        open={!!reactors?.open}
        onClose={() => setReactors((r) => (r ? { ...r, open: false } : r))}
        touch={touch}
        currentUserId={currentUserId}
        meName={user?.name ?? '나'}
        description="이 코멘트에 반응한 사람"
      />
    </section>
  );
}
