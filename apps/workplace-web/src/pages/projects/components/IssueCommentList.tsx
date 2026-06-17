// 이슈 코멘트 리스트 + 신규 작성 폼.
// useCreateComment 훅으로 작성 후 detail 쿼리 무효화로 갱신.
// 본인(HUMAN) 코멘트에만 수정·삭제 버튼 노출 (#154).

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { Textarea } from '@/components/ui/textarea';

import { useAuth } from '../../../hooks/useAuth';
import {
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from '../../../hooks/queries/useIssueComments';
import { handleApiError } from '../../../lib/api-error';
import { type CreateCommentFormData, createCommentSchema } from '../../../lib/validations/issue';
import type { IssueCommentResponse } from '../../../types/issue';

// 개별 코멘트 항목 — 본인 HUMAN 코멘트에만 수정·삭제 액션 제공.
function CommentItem({
  comment,
  isOwn,
  projectKey,
  issueNumber,
  issueId,
}: {
  comment: IssueCommentResponse;
  isOwn: boolean;
  projectKey: string;
  issueNumber: number;
  issueId: number;
}) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);

  const update = useUpdateComment(projectKey, issueNumber, issueId);
  const remove = useDeleteComment(projectKey, issueNumber, issueId);

  const isAgent = comment.authorKind === 'AGENT';

  // 수정 저장 — PATCH 호출 후 편집 모드 종료.
  const handleSave = async () => {
    if (!editBody.trim()) return;
    try {
      await update.mutateAsync({ commentId: comment.id, data: { body: editBody } });
      setEditing(false);
      toast.success('코멘트를 수정했습니다');
    } catch (e) {
      handleApiError(e, '코멘트 수정에 실패했습니다');
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
          <span>· {new Date(comment.createdAt).toLocaleString('ko-KR')}</span>
        </div>

        {/* 본인 HUMAN 코멘트에만 hover 시 액션 버튼 노출 */}
        {isOwn && !editing && (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              aria-label="코멘트 수정"
              onClick={() => {
                setEditBody(comment.body);
                setEditing(true);
              }}
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

      {/* 본문: 편집 모드면 인라인 Textarea, 아니면 텍스트 */}
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={3}
            autoFocus
            aria-label="코멘트 내용 수정"
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={update.isPending}
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={update.isPending || !editBody.trim()}
            >
              {update.isPending ? '저장 중…' : '저장'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="whitespace-pre-wrap mt-1">{comment.body}</div>
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
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateCommentFormData>({
    resolver: zodResolver(createCommentSchema),
  });

  // 폼 제출 → API 호출 → 성공 시 폼 리셋 및 토스트, 실패 시 공통 에러 핸들러로 위임.
  const onSubmit = async (data: CreateCommentFormData) => {
    try {
      await create.mutateAsync(data);
      reset();
      toast.success('코멘트를 작성했습니다');
    } catch (e) {
      handleApiError(e, '코멘트 작성에 실패했습니다');
    }
  };

  return (
    <section aria-label="코멘트" className="space-y-3">
      <h2 className="text-lg font-semibold">코멘트</h2>
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
          />
        ))}
        {comments.length === 0 && (
          <li className="text-muted-foreground text-sm">코멘트가 없습니다</li>
        )}
      </ul>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        {/* resize-none 으로 RichInput(이슈 채팅)과 시각 일관성 유지 (#310) */}
        <Textarea
          {...register('body')}
          placeholder="코멘트를 작성하세요"
          rows={3}
          className="resize-none"
        />
        {errors.body && <p className="text-sm text-destructive">{errors.body.message}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? '작성 중…' : '작성'}
          </Button>
        </div>
      </form>
    </section>
  );
}
