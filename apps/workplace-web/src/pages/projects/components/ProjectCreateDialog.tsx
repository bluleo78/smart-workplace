import { zodResolver } from '@hookform/resolvers/zod';
import { isAxiosError } from 'axios';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { useCreateProject } from '../../../hooks/queries/useProjects';
import { extractApiError, handleApiError } from '../../../lib/api-error';
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
  const { register, handleSubmit, reset, watch, setValue, setError, formState: { errors } } = useForm<
    CreateProjectFormInput,
    unknown,
    CreateProjectFormData
  >({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { type: 'TEAM' },
  });
  // 프로젝트 유형 — TEAM(팀 공유, 키 입력) | PERSONAL(개인 전용, 키 자동) | OPEN(공개 접수함, 키 입력).
  const type = watch('type');

  // dialog가 열릴 때 폼 상태 초기화 — 닫혀있는 동안 react-hook-form 상태가 유지되므로 재열기 시 reset 필요.
  useEffect(() => {
    if (!open) return;
    reset({ type: 'TEAM' });
  }, [open, reset]);

  const onSubmit = async (data: CreateProjectFormData) => {
    try {
      // PERSONAL 은 key 를 보내지 않는다(서버가 자동 생성). TEAM·OPEN 은 key 포함.
      const payload =
        data.type === 'PERSONAL'
          ? { name: data.name, description: data.description, type: 'PERSONAL' as const }
          : data;
      await create.mutateAsync(payload);
      toast.success('프로젝트를 생성했습니다');
      reset();
      onOpenChange(false);
    } catch (e) {
      // key 충돌(409 — 쓰는 key·삭제된 프로젝트가 쓰던 key, WP-692)은 key 칸 아래에 보인다. 토스트는 열린 창의 배경 뒤로 가려 이유를 못 읽는다.
      if (data.type !== 'PERSONAL' && isAxiosError(e) && e.response?.status === 409) {
        setError('key', { message: extractApiError(e, '이미 사용 중인 key 입니다') }, { shouldFocus: true });
        return;
      }
      handleApiError(e, '프로젝트 생성에 실패했습니다');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>새 프로젝트</DialogTitle><DialogDescription className="sr-only">새 프로젝트</DialogDescription></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1">
            <span className="text-sm font-medium">유형</span>
            {/* 유형 토글 — TEAM(팀 공유) | PERSONAL(개인 전용) | OPEN(공개 접수함). MemberSearchPopover 탭 스타일과 동일. */}
            <div className="flex gap-1" role="tablist" aria-label="프로젝트 유형" data-testid="project-type-toggle">
              {(['TEAM', 'PERSONAL', 'OPEN'] as const).map((t) => (
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
                  {t === 'TEAM' ? '팀' : t === 'PERSONAL' ? '개인' : '공개'}
                </Button>
              ))}
            </div>
          </div>
          {/* key 는 TEAM·OPEN 모두 필요(공유 프로젝트). PERSONAL 만 서버 자동 생성. */}
          {(type === 'TEAM' || type === 'OPEN') && (
            // 공용 FormField — 오류가 있으면 입력에 aria-invalid·aria-describedby 를 잇고 오류를 role=alert 로 알린다(WP-466, 새 이슈 다이얼로그와 같은 패턴).
            <FormField label="key (예: WP)" htmlFor="project-key" required error={errors.key?.message}>
              <Input id="project-key" {...register('key')} placeholder="WP" />
            </FormField>
          )}
          <FormField label="이름" htmlFor="project-name" required error={errors.name?.message}>
            <Input id="project-name" {...register('name')} />
          </FormField>
          <FormField label="설명" htmlFor="project-desc" error={errors.description?.message}>
            <Textarea id="project-desc" {...register('description')} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? '생성 중…' : '생성'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
