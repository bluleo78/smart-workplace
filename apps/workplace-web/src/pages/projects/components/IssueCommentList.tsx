// 이슈 코멘트 리스트 + 신규 작성 폼. useCreateComment 훅으로 작성 후 detail 쿼리 무효화로 갱신.

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { useCreateComment } from '../../../hooks/queries/useIssueComments';
import { handleApiError } from '../../../lib/api-error';
import { type CreateCommentFormData,createCommentSchema } from '../../../lib/validations/issue';
import type { IssueCommentResponse } from '../../../types/issue';

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
        {comments.map((c) => {
          const isAgent = c.authorKind === 'AGENT';
          return (
            <li
              key={c.id}
              className={
                isAgent
                  ? 'border border-blue-500/50 bg-blue-50/40 dark:bg-blue-950/20 rounded p-3'
                  : 'border rounded p-3'
              }
              data-agent={isAgent ? 'true' : undefined}
            >
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                <span>{c.authorName}</span>
                {isAgent && (
                  <Badge
                    variant="secondary"
                    className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  >
                    AI
                  </Badge>
                )}
                <span>· {new Date(c.createdAt).toLocaleString('ko-KR')}</span>
              </div>
              <div className="whitespace-pre-wrap mt-1">{c.body}</div>
            </li>
          );
        })}
        {comments.length === 0 && (
          <li className="text-muted-foreground text-sm">코멘트가 없습니다</li>
        )}
      </ul>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
        <Textarea
          {...register('body')}
          placeholder="코멘트를 작성하세요"
          rows={3}
        />
        {errors.body && <p className="text-sm text-destructive">{errors.body.message}</p>}
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>{create.isPending ? '작성 중…' : '작성'}</Button>
        </div>
      </form>
    </section>
  );
}
