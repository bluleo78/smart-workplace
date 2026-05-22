import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { useCreateProject } from '../../../hooks/queries/useProjects';
import { handleApiError } from '../../../lib/api-error';
import { createProjectSchema, type CreateProjectFormData } from '../../../lib/validations/project';

// 새 프로젝트 생성 모달. 성공 시 부모(목록 페이지)가 닫고 invalidate 처리.
export function ProjectCreateDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateProject();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateProjectFormData>({
    resolver: zodResolver(createProjectSchema),
  });

  const onSubmit = async (data: CreateProjectFormData) => {
    try {
      await create.mutateAsync(data);
      toast.success('프로젝트를 생성했습니다');
      reset();
      onOpenChange(false);
    } catch (e) {
      handleApiError(e, '프로젝트 생성에 실패했습니다');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>새 프로젝트</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="project-key">key (예: WP)</label>
            <Input id="project-key" {...register('key')} placeholder="WP" />
            {errors.key && <p className="text-sm text-destructive">{errors.key.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="project-name">이름</label>
            <Input id="project-name" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="project-desc">설명</label>
            <Textarea id="project-desc" {...register('description')} />
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
