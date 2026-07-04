import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { AiClassifyButton } from '../../../components/issue/AiClassifyButton';
import { useIssueAiClassify } from '../../../hooks/queries/useIssueAiClassify';
import { useCreateIssue } from '../../../hooks/queries/useIssues';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { handleApiError } from '../../../lib/api-error';
import { getIssueTypeLabel } from '../../../lib/issueTypeLabels';
import { type CreateIssueFormData,createIssueSchema } from '../../../lib/validations/issue';

// 새 이슈 생성 모달. priority 기본 MID, dueDate 미지정 시 빈 문자열 → API 호출 직전 undefined 변환.
// 유형 select 의 기본값은 프로젝트 유형 목록에서 name === 'TASK' 인 id (없으면 첫 번째).
// personal=true 면 개인 프로젝트(#226) — 유형 select 를 숨긴다. 기본값 effect 가 typeId 를 TASK 로
// 채우므로 셀렉트가 없어도 payload 의 typeId 는 TASK 로 유지된다.
export function IssueCreateDialog({
  projectKey, open, onOpenChange, personal = false,
}: { projectKey: string; open: boolean; onOpenChange: (v: boolean) => void; personal?: boolean }) {
  const create = useCreateIssue(projectKey);
  const classify = useIssueAiClassify(projectKey);
  // AI 제안 이유 — 제안 후 버튼 아래 표시.
  const [classifyReason, setClassifyReason] = useState<string | null>(null);
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

  // dialog가 열릴 때 폼 상태 초기화 — 닫혀있는 동안 react-hook-form 상태가 유지되므로 재열기 시 reset 필요.
  useEffect(() => {
    if (!open) return;
    reset({ priority: 'MID' });
    setClassifyReason(null); // AI 제안 이유 초기화
  }, [open, reset]);

  // 유형 목록 로드 시 기본값 세팅 — name === 'TASK' 우선, 없으면 첫 항목.
  useEffect(() => {
    const list = types.data;
    if (!list || list.length === 0) return;
    const currentTypeId = watch('typeId');
    if (currentTypeId) return;
    const task = list.find((t) => t.name === 'TASK');
    setValue('typeId', task?.id ?? list[0].id);
    // open 의존: 다이얼로그 재오픈 시 reset 이 typeId 를 지운 뒤 이 effect 가 다시 TASK 기본값을 채우도록 한다.
    // (개인 프로젝트는 select 가 숨겨져 사용자 보정이 불가하므로 payload typeId 누락을 막는 것이 특히 중요.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.data, open]);

  const currentTypeId = watch('typeId');
  // 선택된 유형이 SUBTASK 인지 — parentNumber 입력 동적 노출 + 송신 분기에 사용 (Phase 4a).
  const selectedType = (types.data ?? []).find((t) => t.id === currentTypeId);
  const isSubtaskSelected = selectedType?.name === 'SUBTASK';

  // AI 제안 핸들러 — 현재 폼 제목·본문으로 분류 요청.
  // 성공 시 type/priority 덮어쓰기, reason 표시. AI 제안 실패해도 폼 동작 보존.
  const handleClassify = () => {
    const title = watch('title') ?? '';
    const body = watch('body') ?? '';
    classify.mutate(
      { title, body },
      {
        onSuccess: (result) => {
          // 유형 제안 — 개인 프로젝트(personal=true)는 result.type 이 null 이므로 skip.
          if (result.type && types.data) {
            const matched = types.data.find((t) => t.name === result.type);
            if (matched) setValue('typeId', matched.id);
          }
          // 우선순위 덮어쓰기.
          setValue('priority', result.priority);
          setClassifyReason(result.reason);
        },
        onError: () => {
          toast.error('AI 제안을 받지 못했습니다');
        },
      },
    );
  };

  const onSubmit = async (data: CreateIssueFormData) => {
    const payload = {
      ...data,
      dueDate: data.dueDate || undefined,
      startDate: data.startDate || undefined,
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
        <DialogHeader><DialogTitle>새 태스크</DialogTitle><DialogDescription className="sr-only">새 태스크</DialogDescription></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* 제목 — 필수 필드: FormField required 로 붉은 별표 표시 (캘린더 EventDialog 동일 패턴) */}
          <FormField label="제목" htmlFor="issue-title" required error={errors.title?.message}>
            <Input id="issue-title" {...register('title')} />
          </FormField>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="issue-body">본문</label>
            <Textarea id="issue-body" {...register('body')} rows={6} />
          </div>
          {/* AI 분류 제안 버튼 — 제목이 있을 때만 활성화. */}
          <AiClassifyButton
            hasTitle={!!(watch('title') ?? '').trim()}
            isPending={classify.isPending}
            reason={classifyReason}
            onClick={handleClassify}
          />
          {/* 유형(팀만)/우선순위/시작일/마감일 — 필드 수에 맞춰 컬럼 수를 맞춰 마지막 줄이 혼자 남지 않게 한다. */}
          <div className={personal ? 'grid grid-cols-3 gap-3' : 'grid grid-cols-4 gap-3'}>
            {/* 개인 프로젝트는 TASK 단일 유형(#226) — 유형 select 를 숨긴다(typeId 는 effect 가 TASK 로 채움). */}
            {!personal && (
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="issue-type">유형</label>
                {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270) */}
                {/* shadcn Select — value 는 항상 string 이어야 controlled 유지(undefined 면 mount→로드 사이 uncontrolled→controlled 전환 경고, #364). 미선택은 '' 로 표현. */}
                <Select
                  value={currentTypeId !== undefined ? String(currentTypeId) : ''}
                  onValueChange={(v) => setValue('typeId', Number(v))}
                >
                  <SelectTrigger
                    id="issue-type"
                    data-testid="create-type-select"
                    aria-label="이슈 유형"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(types.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {getIssueTypeLabel(t.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-priority">우선순위</label>
              {/* shadcn Select — native <select> 대신 사용(다크모드 스타일 일관성 #270) */}
              <Select
                value={watch('priority') ?? 'MID'}
                onValueChange={(v) => setValue('priority', v as 'LOW' | 'MID' | 'HIGH')}
              >
                <SelectTrigger id="issue-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">낮음</SelectItem>
                  <SelectItem value="MID">보통</SelectItem>
                  <SelectItem value="HIGH">높음</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="issue-start">시작일</label>
              <Input id="issue-start" type="date" {...register('startDate')} />
              {errors.startDate && (
                <p className="text-sm text-destructive">{errors.startDate.message}</p>
              )}
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
            <Button type="submit" disabled={create.isPending}>{create.isPending ? '생성 중…' : '생성'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
