import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { useCreateIssue } from '../../../hooks/queries/useIssues';
import { handleApiError } from '../../../lib/api-error';
import { createIssueSchema, type CreateIssueFormData } from '../../../lib/validations/issue';

// 새 이슈 생성 모달. priority 기본 MID, dueDate 미지정 시 빈 문자열 → API 호출 직전 undefined 변환.
export function IssueCreateDialog({
  projectKey, open, onOpenChange,
}: { projectKey: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateIssue(projectKey);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateIssueFormData>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: { priority: 'MID' },
  });

  const onSubmit = async (data: CreateIssueFormData) => {
    const payload = {
      ...data,
      dueDate: data.dueDate || undefined,
      body: data.body || undefined,
    };
    try {
      await create.mutateAsync(payload);
      toast.success('태스크를 생성했습니다');
      reset({ priority: 'MID' });
      onOpenChange(false);
    } catch (e) {
      handleApiError(e, '태스크 생성에 실패했습니다');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>새 태스크</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="issue-title">제목</label>
            <Input id="issue-title" {...register('title')} />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="issue-body">본문</label>
            <Textarea id="issue-body" {...register('body')} rows={6} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-priority">우선순위</label>
              <select id="issue-priority" {...register('priority')} className="w-full border rounded p-2 bg-background">
                <option value="LOW">낮음</option>
                <option value="MID">보통</option>
                <option value="HIGH">높음</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-due">마감일</label>
              <Input id="issue-due" type="date" {...register('dueDate')} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={create.isPending}>생성</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
