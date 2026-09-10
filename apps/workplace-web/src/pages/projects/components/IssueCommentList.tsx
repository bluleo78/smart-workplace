// 이슈 코멘트 리스트 + 신규 작성 폼.
// useCreateComment 훅으로 작성 후 detail 쿼리 무효화로 갱신.
// 본인(HUMAN) 코멘트에만 수정·삭제 버튼 노출 (#154).
// #785: 작성/수정 입력을 shadcn Textarea 대신 이슈 채팅과 동일한 RichInput + 공용 멘션
// 파이프라인(lib/chat-mentions.ts, components/mentions/*)으로 교체 — @ 자동완성 지원.
// 코멘트는 별도 mentions 필드가 없으므로(백엔드 미지원) 프로젝트 멤버 목록으로 <@id> 토큰을
// 이름/종류로 역매핑한다(읽기 렌더·수정 폼 초기값 공용).

import { Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { parseMessageSegments } from '@/components/mentions/parseMessageSegments';
import { RichInput } from '@/components/mentions/RichInput';
import type { MentionCandidate, MentionUser } from '@/components/mentions/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';

import {
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from '../../../hooks/queries/useIssueComments';
import { useProjectMembers } from '../../../hooks/queries/useProjectMembers';
import { useAuth } from '../../../hooks/useAuth';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import { handleApiError } from '../../../lib/api-error';
import { formatDateTimeMinute } from '../../../lib/formatters';
import type { IssueCommentResponse } from '../../../types/issue';

// 코멘트 본문 최대 길이 — createCommentSchema/updateCommentSchema(서버 @Size)와 동일 기준.
const COMMENT_MAX_LENGTH = 10000;

// 개별 코멘트 항목 — 본인 HUMAN 코멘트에만 수정·삭제 액션 제공.
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

  return (
    <li
      className={[
        'relative group border rounded p-3',
        isAgent ? 'border-ai-accent/50 bg-ai-accent-subtle/40' : '',
      ].join(' ')}
      data-agent={isAgent ? 'true' : undefined}
    >
      {/* 헤더: 작성자 + 날짜 + (본인 코멘트) 수정·삭제 버튼 */}
      <div className="flex items-center justify-between gap-1">
        <div className="text-sm text-muted-foreground flex items-center gap-1">
          <span>{comment.authorName}</span>
          {isAgent && (
            <Badge
              variant="secondary"
              className="bg-ai-accent-subtle text-ai-accent"
            >
              AI
            </Badge>
          )}
          {/* parseUtcDate 를 내장한 formatDateTimeMinute 로 UTC→로컬 변환 + 분 단위 표시 (#320) */}
          <span>· {formatDateTimeMinute(comment.createdAt)}</span>
        </div>

        {/* 본인 HUMAN 코멘트에만 hover 시 액션 버튼 노출 */}
        {isOwn && !editing && (
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
              itemName={comment.body.slice(0, 20) + (comment.body.length > 20 ? '…' : '')}
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
        )}
      </div>

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
      ) : (
        /* 디자인 시스템 body-secondary 적용 — text-sm(14px) · leading-6 · text-foreground (#344) */
        /* 같은 페이지의 이슈 채팅(ChatMessageRow)과 동일한 멘션 칩 스타일로 <@id> 토큰을 렌더 (#785, #208) */
        <div className="whitespace-pre-wrap mt-1 text-sm leading-6 text-foreground">
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
}: {
  projectKey: string;
  issueNumber: number;
  issueId: number;
  comments: IssueCommentResponse[];
}) {
  const { user } = useAuth();
  const create = useCreateComment(projectKey, issueNumber, issueId);

  // 프로젝트 멤버 = RichInput @ 자동완성 후보이자, 본문 <@id> 토큰의 이름/종류 역매핑 소스.
  const membersQuery = useProjectMembers(projectKey);
  const mentionCandidates: MentionCandidate[] = membersQuery.data ?? [];
  const mentionUsers: MentionUser[] = mentionCandidates.map((m) => ({
    id: m.userId,
    name: m.name,
    kind: m.kind,
  }));

  // 새로고침 시 작성 중이던 코멘트 유실 방지 (#620) — RichInput 은 실시간 본문을 노출하지 않으므로
  // "입력 발생 여부"로 근사한다. 제출 성공 직후의 clearOnSubmit 이 유발하는 onChange 는
  // suppressNextChangeRef 로 걸러 거짓 경고를 막는다.
  const [hasDraft, setHasDraft] = useState(false);
  const suppressNextChangeRef = useRef(false);
  useUnsavedChangesWarning(hasDraft);

  const handleDraftChange = () => {
    if (suppressNextChangeRef.current) {
      suppressNextChangeRef.current = false;
      setHasDraft(false);
      return;
    }
    setHasDraft(true);
  };

  // 제출 → API 호출 → 성공 시 clearOnSubmit 이 입력창을 비움 + 토스트, 실패 시 입력 보존(reject) + 공통 에러 핸들러.
  const handleSubmit = async (body: string): Promise<void> => {
    try {
      await create.mutateAsync({ body });
      suppressNextChangeRef.current = true;
      toast.success('코멘트를 작성했습니다');
    } catch (e) {
      handleApiError(e, '코멘트 작성에 실패했습니다');
      throw e;
    }
  };

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
      <div className="space-y-2">
        {/* RichInput — 이슈 채팅(ChatComposer)과 동일한 컴포넌트로 시각 일관성(#310) + 멘션 자동완성(#785) 확보 */}
        <RichInput
          members={mentionCandidates}
          onSubmit={handleSubmit}
          onChange={handleDraftChange}
          clearOnSubmit
          disableWhenEmpty
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="코멘트를 작성하세요"
          submitLabel={create.isPending ? '작성 중…' : '작성'}
          submitDisabled={create.isPending}
          inputTestId="issue-comment-input"
          submitTestId="issue-comment-submit"
        />
      </div>
    </section>
  );
}
