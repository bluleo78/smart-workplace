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

import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useCreateIssue } from '../../../hooks/queries/useIssues';
import { handleApiError } from '../../../lib/api-error';
import { createIssueSchema, type CreateIssueFormData } from '../../../lib/validations/issue';

// 새 이슈 생성 모달. priority 기본 MID, dueDate 미지정 시 빈 문자열 → API 호출 직전 undefined 변환.
// 유형 select 의 기본값은 프로젝트 유형 목록에서 name === 'TASK' 인 id (없으면 첫 번째).
export function IssueCreateDialog({
  projectKey, open, onOpenChange,
}: { projectKey: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateIssue(projectKey);
  const types = useIssueTypes(projectKey);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateIssueFormData>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: { priority: 'MID' },
  });

  // 유형 목록 로드 시 기본값 세팅 — name === 'TASK' 우선, 없으면 첫 항목.
  useEffect(() => {
    const list = types.data;
    if (!list || list.length === 0) return;
    const currentTypeId = watch('typeId');
    if (currentTypeId) return;
    const task = list.find((t) => t.name === 'TASK');
    setValue('typeId', task?.id ?? list[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.data]);

  const currentTypeId = watch('typeId');
  // 선택된 유형이 SUBTASK 인지 — parentNumber 입력 동적 노출 + 송신 분기에 사용 (Phase 4a).
  const selectedType = (types.data ?? []).find((t) => t.id === currentTypeId);
  const isSubtaskSelected = selectedType?.name === 'SUBTASK';

  const onSubmit = async (data: CreateIssueFormData) => {
    const payload = {
      ...data,
      dueDate: data.dueDate || undefined,
      body: data.body || undefined,
      typeId: data.typeId ?? undefined,
      // SUBTASK 가 아닐 때는 parentNumber 를 절대 보내지 않는다 — 백엔드가 400.
      parentNumber: isSubtaskSelected ? (data.parentNumber ?? undefined) : undefined,
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
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-type">유형</label>
              <select
                id="issue-type"
                value={currentTypeId ?? ''}
                onChange={(e) => setValue('typeId', Number(e.target.value))}
                data-testid="create-type-select"
                aria-label="이슈 유형"
                className="w-full border rounded p-2 bg-background"
              >
                {(types.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
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
          {/* SUBTASK 선택 시에만 부모 number 입력 노출 (Phase 4a).
              valueAsNumber 로 number 변환 — 빈 값은 NaN 이 되어 송신 시 undefined. */}
          {isSubtaskSelected && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="create-parent-number">
                부모 이슈 번호
              </label>
              <Input
                id="create-parent-number"
                type="number"
                min={1}
                {...register('parentNumber', { valueAsNumber: true })}
                data-testid="create-parent-number"
              />
              {errors.parentNumber && (
                <p className="text-sm text-destructive">{errors.parentNumber.message}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" disabled={create.isPending}>생성</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
