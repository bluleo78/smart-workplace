import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useIssueAiClassify } from '../../../hooks/queries/useIssueAiClassify';
import { useCreateIssue } from '../../../hooks/queries/useIssues';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useIssueImageUpload } from '../../../hooks/useIssueImageUpload';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import { handleApiError } from '../../../lib/api-error';
import { type CreateIssueFormData, createIssueSchema } from '../../../lib/validations/issue';

// 이슈 생성 폼 로직 — 데스크톱 다이얼로그와 모바일 시트가 공유한다(WP-196). 렌더링은 각 컴포넌트 몫.
export function useIssueCreateForm({
  projectKey, open, onOpenChange, initialTypeId,
}: {
  projectKey: string; open: boolean; onOpenChange: (v: boolean) => void;
  // 유형 기본값 오버라이드 — 에픽 패널 「＋ 에픽 만들기」가 EPIC id 를 넘긴다. 미지정 시 기존 TASK 기본.
  initialTypeId?: number;
}) {
  const create = useCreateIssue(projectKey);
  const classify = useIssueAiClassify(projectKey);
  // AI 제안 이유 — 제안 후 버튼 아래 표시.
  const [classifyReason, setClassifyReason] = useState<string | null>(null);
  const types = useIssueTypes(projectKey);
  // 모바일 에픽 칩 값(R8) — 폼 스키마 밖 별도 상태. 일반 이슈의 parentNumber 로 송신되고, EPIC·SUBTASK 유형이면 해제된다.
  const [epicNumber, setEpicNumber] = useState<number | null>(null);
  const form = useForm<CreateIssueFormData>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: { priority: 'MID' },
  });
  const { register, handleSubmit, reset, getValues, setValue, watch } = form;

  // 본문 이미지 업로드(WP-199) — register 의 ref 와 우리 ref 를 함께 쓰기 위해 bodyField.ref 를 감싼다.
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyField = register('body');
  const images = useIssueImageUpload({
    projectKey,
    textareaRef: bodyRef,
    getValue: () => getValues('body') ?? '',
    setValue: (v) => setValue('body', v, { shouldDirty: true }),
  });

  // dialog가 열릴 때 폼 상태 초기화 — 닫혀있는 동안 react-hook-form 상태가 유지되므로 재열기 시 reset 필요.
  useEffect(() => {
    if (!open) return;
    reset({ priority: 'MID' });
    setClassifyReason(null); // AI 제안 이유 초기화
    setEpicNumber(null); // 에픽 칩 선택 초기화
  }, [open, reset]);

  // 유형 목록 로드 시 기본값 세팅 — name === 'TASK' 우선, 없으면 첫 항목.
  useEffect(() => {
    const list = types.data;
    if (!list || list.length === 0) return;
    const currentTypeId = watch('typeId');
    if (currentTypeId) return;
    const task = list.find((t) => t.name === 'TASK');
    // initialTypeId 우선(존재하는 유형일 때만) → TASK → 첫 항목.
    const preferred = initialTypeId != null ? list.find((t) => t.id === initialTypeId) : undefined;
    setValue('typeId', preferred?.id ?? task?.id ?? list[0].id);
    // open 의존: 다이얼로그 재오픈 시 reset 이 typeId 를 지운 뒤 이 effect 가 다시 TASK 기본값을 채우도록 한다.
    // (개인 프로젝트는 select 가 숨겨져 사용자 보정이 불가하므로 payload typeId 누락을 막는 것이 특히 중요.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.data, open]);

  const currentTypeId = watch('typeId');
  // 선택된 유형이 SUBTASK 인지 — parentNumber 입력 동적 노출 + 송신 분기에 사용 (Phase 4a).
  const selectedType = (types.data ?? []).find((t) => t.id === currentTypeId);
  const isSubtaskSelected = selectedType?.name === 'SUBTASK';
  const isEpicSelected = selectedType?.name === 'EPIC';

  // 유형이 EPIC/SUBTASK 로 바뀌면 에픽 해제 — 남은 값이 parentNumber 로 새면 백엔드가 400.
  useEffect(() => {
    if (isEpicSelected || isSubtaskSelected) setEpicNumber(null);
  }, [isEpicSelected, isSubtaskSelected]);

  // 새로고침 시 입력값 유실 방지 (#620) — 모달이 열려 있고 제목/본문 중 하나라도
  // 입력되어 있으면 beforeunload 확인 다이얼로그를 띄운다.
  const titleValue = watch('title');
  const bodyValue = watch('body');
  // hasContent 는 모바일 시트의 버림 확인에도 쓰인다.
  const hasContent = !!((titleValue ?? '').trim() || (bodyValue ?? '').trim());
  useUnsavedChangesWarning(open && hasContent);

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

  const submit = async (data: CreateIssueFormData) => {
    // 업로드가 끝나지 않은 자리표시 토큰이 저장되지 않게 마지막으로 막는다(버튼 비활성의 우회 경로 — Enter 제출 등).
    if (images.pendingBlock(data.body ?? '')) {
      toast.error('이미지 업로드가 끝난 뒤 등록해 주세요');
      return;
    }
    const payload = {
      ...data,
      dueDate: data.dueDate || undefined,
      startDate: data.startDate || undefined,
      body: data.body || undefined,
      typeId: data.typeId ?? undefined,
      // SUBTASK=부모 태스크 번호, 일반 이슈=모바일 에픽 칩(R8, 백엔드는 일반 이슈 부모로 EPIC 만 허용), EPIC=부모 불가.
      parentNumber: isSubtaskSelected
        ? (data.parentNumber ?? undefined)
        : !isEpicSelected && epicNumber != null ? epicNumber : undefined,
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

  return {
    form, types, selectedType, isSubtaskSelected, isEpicSelected,
    classify, classifyReason, handleClassify, images, bodyRef, bodyField,
    onSubmit: handleSubmit(submit),
    // 버튼 비활성 = 생성 요청 중 또는 이미지 업로드 중. 「생성 중…」 문구는 실제 생성 요청 중일 때만(isCreating) — 업로드 중엔 「생성」 유지.
    isSubmitting: create.isPending || images.isUploading,
    isCreating: create.isPending,
    hasContent, epicNumber, setEpicNumber,
  };
}
