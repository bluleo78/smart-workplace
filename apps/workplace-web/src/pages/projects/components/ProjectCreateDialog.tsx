import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
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
import {
  type CreateProjectFormData,
  type CreateProjectFormInput,
  createProjectSchema,
} from '../../../lib/validations/project';

// 새 프로젝트 생성 모달. 성공 시 부모(목록 페이지)가 닫고 invalidate 처리.
export function ProjectCreateDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateProject();
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<
    CreateProjectFormInput,
    unknown,
    CreateProjectFormData
  >({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { type: 'TEAM' },
  });
  // 프로젝트 유형 — TEAM(키 입력) | PERSONAL(키 서버 자동 생성).
  const type = watch('type');

  // dialog가 열릴 때 폼 상태 초기화 — 닫혀있는 동안 react-hook-form 상태가 유지되므로 재열기 시 reset 필요.
  useEffect(() => {
    if (!open) return;
    reset({ type: 'TEAM' });
  }, [open, reset]);

  const onSubmit = async (data: CreateProjectFormData) => {
    try {
      // PERSONAL 은 key 를 보내지 않는다(서버가 자동 생성).
      const payload =
        data.type === 'PERSONAL'
          ? { name: data.name, description: data.description, type: 'PERSONAL' as const }
          : data;
      await create.mutateAsync(payload);
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
            <span className="text-sm font-medium">유형</span>
            {/* 유형 토글 — TEAM(팀 공유, 키 입력) | PERSONAL(개인 전용, 키 자동). MemberSearchPopover 탭 스타일과 동일. */}
            <div className="flex gap-1" role="tablist" aria-label="프로젝트 유형" data-testid="project-type-toggle">
              {(['TEAM', 'PERSONAL'] as const).map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={type === t ? 'default' : 'ghost'}
                  onClick={() => setValue('type', t)}
                  role="tab"
                  aria-selected={type === t}
                  data-testid={`project-type-${t}`}
                >
                  {t === 'TEAM' ? '팀' : '개인'}
                </Button>
              ))}
            </div>
          </div>
          {type === 'TEAM' && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="project-key">key (예: WP)</label>
              <Input id="project-key" {...register('key')} placeholder="WP" />
              {errors.key && <p className="text-sm text-destructive">{errors.key.message}</p>}
            </div>
          )}
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
            <Button type="submit" disabled={create.isPending}>{create.isPending ? '생성 중…' : '생성'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
