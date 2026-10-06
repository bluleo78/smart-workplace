// 이슈 코멘트 리스트 + 신규 작성 폼(IssueCommentComposer — 모바일은 hideComposer 로 빼고 화면 하단에 둔다, WP-196).
// useCreateComment 훅으로 작성 후 detail 쿼리 무효화로 갱신.
// 본인(HUMAN) 코멘트에만 수정·삭제 버튼 노출 (#154).
// #785: 작성/수정 입력을 shadcn Textarea 대신 이슈 채팅과 동일한 RichInput + 공용 멘션
// 파이프라인(lib/chat-mentions.ts, components/mentions/*)으로 교체 — @ 자동완성 지원.
// 코멘트는 별도 mentions 필드가 없으므로(백엔드 미지원) 프로젝트 멤버 목록으로 <@id> 토큰을
// 이름/종류로 역매핑한다(읽기 렌더·수정 폼 초기값 공용).

import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { MarkdownMessage } from '@/components/ai/MarkdownMessage';
import { parseMessageSegments } from '@/components/mentions/parseMessageSegments';
import { RichInput } from '@/components/mentions/RichInput';
import type { MentionCandidate, MentionUser } from '@/components/mentions/types';
import type { MobileSheetAction } from '@/components/mobile/MobileActionSheet';
import { TouchRowActionsMenu } from '@/components/mobile/TouchRowActionsMenu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useDeleteComment, useUpdateComment } from '../../../hooks/queries/useIssueComments';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useAuth } from '../../../hooks/useAuth';
import { handleApiError } from '../../../lib/api-error';
import { formatDateTimeMinute } from '../../../lib/formatters';
import type { IssueCommentResponse } from '../../../types/issue';
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
}) {
  const [editing, setEditing] = useState(false);
  // WP-223: 모바일은 hover 가 없어 ⋯ → 액션 시트로 수정·삭제를 연다.
  // WP-237: ≥1024px 터치 태블릿(pointer: coarse)도 hover 가 없다 — 터치면 TouchRowActionsMenu 하나로
  // 폭에 따라 시트(<1024)/드롭다운(≥1024)을 연다. 삭제 확인창은 메뉴 밖에서 state 로 연다(메뉴가 닫혀도 유지).
  const isCoarse = useIsCoarsePointer();
  const isMobile = useIsMobile();
  const touch = isMobile || isCoarse;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const commentActions: MobileSheetAction[] = [
    { key: 'edit', label: '수정', icon: <Pencil />, onSelect: () => setEditing(true) },
    { key: 'delete', label: '삭제', icon: <Trash2 />, destructive: true, onSelect: () => setConfirmOpen(true) },
  ];

  const update = useUpdateComment(projectKey, issueNumber, issueId);
  const remove = useDeleteComment(projectKey, issueNumber, issueId);

  const isAgent = comment.authorKind === 'AGENT';

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

  const itemName = comment.body.slice(0, 20) + (comment.body.length > 20 ? '…' : '');

  return (
    <li
      className={[
        // min-w-0 — 카드가 flex/grid 자식일 때 긴 내용이 카드 폭을 밀어내지 않게(WP-228).
        'relative group min-w-0 border rounded p-3',
        isAgent ? 'border-ai-accent/50 bg-ai-accent-subtle/40' : '',
      ].join(' ')}
      data-agent={isAgent ? 'true' : undefined}
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

        {/* 본인 HUMAN 코멘트에만 액션 노출 — 터치는 ⋯ 메뉴, 마우스는 hover 아이콘 */}
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
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
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

      {isOwn && touch && (
        <DeleteConfirmDialog
          entityName="코멘트"
          itemName={itemName}
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
          />
        </div>
      ) : isAgent ? (
        /* WP-254: AI(에이전트) 코멘트는 체크리스트·제목·표 등 마크다운을 쓰므로 MarkdownMessage 로 렌더
           (이슈 채팅 ChatMessageRow 와 동일 패턴 — 사람 코멘트는 아래 멘션 칩 평문 유지). 원시 HTML 은 여전히 비허용.
           whitespace-pre-wrap 은 빼야 한다 — 블록 사이 개행 텍스트 노드가 빈 줄로 보인다(p 가 자체로 줄바꿈 보존). */
        <MarkdownMessage className="mt-1 leading-6 text-foreground">
          {mentionsToMarkdown(comment.body, mentionUsers)}
        </MarkdownMessage>
      ) : (
        /* 디자인 시스템 body-secondary 적용 — text-sm(14px) · leading-6 · text-foreground (#344) */
        /* 같은 페이지의 이슈 채팅(ChatMessageRow)과 동일한 멘션 칩 스타일로 <@id> 토큰을 렌더 (#785, #208) */
        /* [overflow-wrap:anywhere] — 공백 없는 긴 URL·단어도 카드 폭에서 줄바꿈(WP-228). */
        <div className="whitespace-pre-wrap mt-1 text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
          {parseMessageSegments(comment.body, mentionUsers).map((seg, i) =>
            seg.type === 'text' ? (
              <span key={i}>{seg.value}</span>
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
    </li>
  );
}

// 코멘트 목록을 시간순으로 표시하고, 하단 폼에서 신규 코멘트를 추가.
export function IssueCommentList({
  projectKey,
  issueNumber,
  issueId,
  comments,
  hideComposer = false,
}: {
  projectKey: string;
  issueNumber: number;
  issueId: number;
  comments: IssueCommentResponse[];
  /** 모바일(WP-196)은 작성창을 화면 하단 줄에 따로 두므로 목록 아래 작성창을 뺀다(testid 중복 방지). */
  hideComposer?: boolean;
}) {
  const { user } = useAuth();

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
      <ul className="space-y-2" role="list">
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
          />
        ))}
        {comments.length === 0 && (
          <li className="text-muted-foreground text-sm">코멘트가 없습니다</li>
        )}
      </ul>
      {!hideComposer && (
        <div className="space-y-2">
          <IssueCommentComposer projectKey={projectKey} issueNumber={issueNumber} issueId={issueId} />
        </div>
      )}
    </section>
  );
}
