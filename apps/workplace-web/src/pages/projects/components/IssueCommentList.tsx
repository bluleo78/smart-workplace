// 이슈 코멘트 리스트 + 신규 작성 폼(IssueCommentComposer — 모바일은 hideComposer 로 빼고 화면 하단에 둔다, WP-196).
// useCreateComment 훅으로 작성 후 detail 쿼리 무효화로 갱신.
// 본인(HUMAN) 코멘트에만 수정·삭제 버튼 노출 (#154).
// #785: 작성/수정 입력을 shadcn Textarea 대신 이슈 채팅과 동일한 RichInput + 공용 멘션
// 파이프라인(lib/chat-mentions.ts, components/mentions/*)으로 교체 — @ 자동완성 지원.
// 코멘트는 별도 mentions 필드가 없으므로(백엔드 미지원) 프로젝트 멤버 목록으로 <@id> 토큰을
// 이름/종류로 역매핑한다(읽기 렌더·수정 폼 초기값 공용).

import { Pencil, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
import { IssueBodyImage } from '@/components/issue/IssueBodyImage';
import { countApiImages, splitApiImages, withImagePlaceholders } from '@/components/mentions/apiImageSegments';
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments';
import { RichInput } from '@/components/mentions/RichInput';
import type { MentionCandidate, MentionUser } from '@/components/mentions/types';
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu';
import { ReactorsOverlay } from '@/components/reactions/ReactorsOverlay';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMessageListLongPress } from '@/hooks/useMessageListLongPress';
import { useRestoreFocusOnExit } from '@/hooks/useRestoreFocusOnExit';

import { uploadIssueImage } from '../../../api/issueImages';
import { commentReactorSource } from '../../../hooks/queries/commentReactorSource';
import { useDeleteComment, useUpdateComment } from '../../../hooks/queries/useIssueComments';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useToggleCommentReaction } from '../../../hooks/queries/useToggleCommentReaction';
import { useAuth } from '../../../hooks/useAuth';
import { handleApiError } from '../../../lib/api-error';
import { formatDateTimeMinute } from '../../../lib/formatters';
import type { IssueCommentResponse } from '../../../types/issue';
import { AddReactionButton, CommentReactions } from './CommentReactions';
import { COMMENT_MAX_LENGTH, IssueCommentComposer } from './IssueCommentComposer';

// 개별 코멘트 항목 — 본인 HUMAN 코멘트에만 수정·삭제 액션 제공.
// 마크다운 특수문자 — 멘션 이름에 섞여 있으면 강조·링크 등으로 해석되지 않게 백슬래시로 이스케이프한다.
const MD_SPECIAL = /[\\`*_[\]<>#|~]/g;

/** AGENT 코멘트용 — <@id> 토큰을 '@이름' 평문으로 바꾼다(마크다운이 토큰을 해석하지 못해 원문이 노출되므로). 미해결 id 는 '@알 수 없음'. */
function mentionsToMarkdown(body: string, users: MentionUser[]): string {
  return parseMessageSegments(body, users)
    .map((seg) => (seg.type === 'text' ? seg.value : `@${seg.name.replace(MD_SPECIAL, '\\$&')}`))
    .join('');
}

function CommentItem({
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
  onOpenReactors: (emoji: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 수정을 끝내면(Esc 취소·저장) 편집기가 사라져 포커스가 body 로 빠졌다 — 「코멘트 수정」 버튼으로 돌린다(WP-813).
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  useRestoreFocusOnExit(editing, editButtonRef);
  const commentActions: MobileSheetAction[] = [
    { key: 'edit', label: '수정', icon: <Pencil />, onSelect: () => setEditing(true) },
    { key: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => setConfirmOpen(true) },
  ];

  const update = useUpdateComment(projectKey, issueNumber, issueId);
  const remove = useDeleteComment(projectKey, issueNumber, issueId);

  const isAgent = comment.authorKind === 'AGENT';
  const { toggle } = useToggleCommentReaction(projectKey, issueNumber, issueId);
  const toggleReaction = (emoji: string) => toggle(comment.id, emoji);
  // 반응 없는 코멘트(마우스)의 😊+ 는 본문 아래가 아니라 헤더 hover 액션 자리에 둔다 — 빈 칩 줄이 공간을 차지하지 않게(WP-504).
  const headerReactionAdd = canReact && !touch && !editing && (comment.reactions ?? []).length === 0;

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
  const preview = withImagePlaceholders(comment.body, projectKey);
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

  return (
    <li
      className={[
        // min-w-0 — 카드가 flex/grid 자식일 때 긴 내용이 카드 폭을 밀어내지 않게(WP-228).
        'relative group min-w-0 border rounded p-3',
        isAgent ? 'border-ai-accent/50 bg-ai-accent-subtle/40' : '',
      ].join(' ')}
      data-agent={isAgent ? 'true' : undefined}
      // 목록의 길게 누르기 위임(useMessageListLongPress)이 칩이 속한 코멘트를 찾는 표식(WP-504).
      data-message-id={comment.id}
    >
      {/* 헤더: 작성자 + 날짜 + (본인 코멘트) 수정·삭제 버튼 */}
      <div className="flex items-center justify-between gap-1">
        {/* 긴 작성자명이 날짜·⋯ 를 밀어내지 않게 — 래퍼가 남은 폭만 쓰고(min-w-0 flex-1) 이름만 말줄임,
            AI 배지·날짜는 줄지도 꺾이지도 않는다(WP-228). */}
        <div className="text-sm text-muted-foreground flex min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 truncate">{comment.authorName}</span>
          {isAgent && (
            <Badge
              variant="secondary"
              className="shrink-0 bg-ai-accent-subtle text-ai-accent"
            >
              AI
            </Badge>
          )}
          {/* parseUtcDate 를 내장한 formatDateTimeMinute 로 UTC→로컬 변환 + 분 단위 표시 (#320) */}
          <span className="shrink-0 whitespace-nowrap">· {formatDateTimeMinute(comment.createdAt)}</span>
        </div>

        {/* 헤더 오른쪽 hover 액션 — 반응 추가(반응 없는 코멘트) + 본인 HUMAN 코멘트의 수정·삭제(터치는 ⋯ 메뉴) */}
        <div className="flex shrink-0 items-center gap-1">
          {headerReactionAdd && (
            <AddReactionButton
              commentId={comment.id}
              variant="header"
              onPick={toggleReaction}
            />
          )}
          {isOwn && !editing && (touch ? (
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
      {editing ? (
        <div className="mt-2">
          <RichInput
            members={mentionCandidates}
            initialBody={comment.body}
            initialMentions={mentionUsers}
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
            submitLabel="저장"
            maxLength={COMMENT_MAX_LENGTH}
            autoFocus
            inputTestId="issue-comment-edit-input"
            submitTestId="issue-comment-edit-save"
            cancelTestId="issue-comment-edit-cancel"
            // WP-362: 기존 이미지는 원래 자리에 썸네일로 복원되고, 새로 붙여넣을 수도 있다.
            imageUpload={(file) => uploadIssueImage(projectKey, file)}
          />
        </div>
      ) : isAgent ? (
        /* WP-254: AI(에이전트) 코멘트는 체크리스트·제목·표 등 마크다운을 쓰므로 MarkdownMessage 로 렌더
           (이슈 채팅 ChatMessageRow 와 동일 패턴 — 사람 코멘트는 아래 멘션 칩 평문 유지). 원시 HTML 은 여전히 비허용.
           whitespace-pre-wrap 은 빼야 한다 — 블록 사이 개행 텍스트 노드가 빈 줄로 보인다(p 가 자체로 줄바꿈 보존). */
        <MarkdownMessage
          className="mt-1 leading-6 text-foreground"
          renderImage={renderImage}
        >
          {mentionsToMarkdown(comment.body, mentionUsers)}
        </MarkdownMessage>
      ) : (
        /* 디자인 시스템 body-secondary 적용 — text-sm(14px) · leading-6 · text-foreground (#344) */
        /* 같은 페이지의 이슈 채팅(ChatMessageRow)과 동일한 멘션 칩 스타일로 <@id> 토큰을 렌더 (#785, #208) */
        /* [overflow-wrap:anywhere] — 공백 없는 긴 URL·단어도 카드 폭에서 줄바꿈(WP-228). */
        <div className="whitespace-pre-wrap mt-1 text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
          {parseMessageSegments(comment.body, mentionUsers).map((seg, i) =>
            seg.type === 'text' ? (
              // WP-362: 글 속 이미지 마크다운은 넣은 자리에 본문 이미지와 같은 렌더러로(클릭 시 뷰어).
              splitApiImages(seg.value, projectKey).map((part, j) =>
                part.type === 'text' ? (
                  <span key={`${i}-${j}`}>{part.value}</span>
                ) : (
                  <IssueBodyImage key={`${i}-${j}`} projectKey={projectKey} src={part.src} alt={part.alt} />
                ),
              )
            ) : (
              <span
                key={i}
                data-testid={`comment-mention-chip-${seg.id}`}
                className={`rounded px-1 font-medium ${
                  seg.kind === 'AGENT'
                    ? 'bg-ai-accent-subtle text-ai-accent'
                    : 'bg-muted text-foreground'
                }`}
              >
                @{seg.name}
              </span>
            ),
          )}
        </div>
      )}

      {/* 이모지 반응(WP-504) — 본문 아래 칩 줄. 편집 중엔 숨긴다(편집창 아래 칩·버튼이 섞이지 않게). */}
      {!editing && (
        <CommentReactions
          comment={comment}
          issueId={issueId}
          canReact={canReact}
          touch={touch}
          currentUserId={currentUserId}
          onOpenReactors={onOpenReactors}
          onToggle={toggleReaction}
        />
      )}
    </li>
  );
}

// 코멘트 목록을 시간순으로 표시하고, 하단 폼에서 신규 코멘트를 추가.
export function IssueCommentList({
  projectKey,
  issueNumber,
  issueId,
  comments,
  canReact,
  hideComposer = false,
}: {
  projectKey: string;
  issueNumber: number;
  issueId: number;
  comments: IssueCommentResponse[];
  /** 코멘트 이모지 반응 추가·취소 가능 여부 — 이슈 상세의 viewerCanEditContent(WP-504). */
  canReact: boolean;
  /** 모바일(WP-196)은 작성창을 화면 하단 줄에 따로 두므로 목록 아래 작성창을 뺀다(testid 중복 방지). */
  hideComposer?: boolean;
}) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? 0;
  const isCoarse = useIsCoarsePointer();
  const isMobile = useIsMobile();
  const touch = isMobile || isCoarse;

  // 반응자 전체 보기(WP-504) — 목록당 하나(채팅 MessageList 와 같은 구조). 데스크톱은 호버 카드의 모두 보기, 터치는 칩 길게 누르기가 연다.
  // 대상은 코멘트 id 로만 들고 최신 목록에서 찾는다(열린 동안 개수 실시간 반영). 닫을 때 대상은 남겨 닫힘 애니메이션 동안 내용이 비지 않게 한다.
  const [reactors, setReactors] = useState<{ id: number; emoji: string; open: boolean } | null>(null);
  const openReactors = useCallback(
    (id: number, emoji: string) => {
      if (comments.some((c) => c.id === id)) setReactors({ id, emoji, open: true });
    },
    [comments],
  );
  const reactorsComment = reactors ? comments.find((c) => c.id === reactors.id) : undefined;
  // 반응이 모두 사라지거나 코멘트가 지워져 오버레이가 숨겨지면 open 도 내린다 — 그대로 두면 나중에 반응이 다시 달릴 때
  // 사용자 조작 없이 저절로 다시 열린다. 렌더 중 상태 조정(효과로 미루면 한 프레임 다시 열린 상태가 그려질 수 있다).
  if (reactors?.open && !reactorsComment?.reactions?.length) setReactors({ ...reactors, open: false });
  // 터치에서 칩을 길게 누르면 반응자 시트 — 코멘트 행 자체의 길게 누르기 작업 시트는 없다(canOpen=false, 네이티브 메뉴 유지).
  const longPress = useMessageListLongPress(touch, () => false, () => {}, openReactors);

  // 프로젝트 멤버 = RichInput @ 자동완성 후보이자, 본문 <@id> 토큰의 이름/종류 역매핑 소스.
  const membersQuery = useProjectMembers(projectKey);
  const mentionCandidates: MentionCandidate[] = membersQuery.data ?? [];
  const mentionUsers: MentionUser[] = mentionCandidates.map((m) => ({
    id: m.userId,
    name: m.name,
    kind: m.kind,
  }));

  return (
    <section aria-label="코멘트" className="space-y-3">
      {/* "코멘트" 레이블 제거 — 상위 탭(코멘트)이 이미 맥락 제공(중복 제거). */}
      <ul className="space-y-2" role="list" {...longPress}>
        {comments.map((c) => (
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
            onOpenReactors={(emoji) => openReactors(c.id, emoji)}
          />
        ))}
        {comments.length === 0 && (
          <li className="text-muted-foreground text-sm">코멘트가 없습니다</li>
        )}
      </ul>
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
      {!hideComposer && (
        <div className="space-y-2">
          <IssueCommentComposer projectKey={projectKey} issueNumber={issueNumber} issueId={issueId} />
        </div>
      )}
    </section>
  );
}
