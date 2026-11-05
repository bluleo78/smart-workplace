// 「AI 에게 맡기기」 편집기(WP-989, WP-1314) — 데스크톱 팝오버와 모바일 바텀시트, 개인 작업과 팀 이슈가 같은 본문을 쓴다.
// 담당 AI(서버 실행 AI 후보 중) + 실행 일정: 안 함 / 한 번만 / 매일 / 평일 / 매주(요일 여러 개, 하나 이상) / 매월(1~31일) / 몇 시간마다(간격·시간대·요일, WP-1373) + 실행 시각(한국 시간 HH:mm).
// 일정 칸은 만들기 창과 같은 TaskRecurrenceScheduleFields 를 쓴다(WP-1315).
// 저장 = PUT(안 함으로 저장하면 기존 일정을 끈다), 「일정 끄기」 = DELETE. 저장하면 서버가 담당 AI 를 담당자에 넣는다.
// 담당 AI 가 남의 개인 비서인 일정(editable=false)은 주인만 바꾸므로 읽기 전용으로 보인다.
// 409(쓸 수 있는 AI 없음·완료된 작업 등)·403 은 훅의 handleApiError 가 토스트로 보인다.
import { useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select';
import { Button } from '@/components/ui/button';
import {
  useDeleteIssueRecurrence,
  useIssueRecurrenceAgents,
  useSaveIssueRecurrence,
} from '@/hooks/queries/useIssueRecurrence';
import {
  agentOptionLabel,
  buildTaskRRule,
  nextRunText,
  parseTaskRRule,
  recurrencePausedText,
  type TaskRecurrenceForm,
  validateTaskRecurrence,
} from '@/lib/issueRecurrence';
import { cn } from '@/lib/utils';
import type { IssueRecurrence } from '@/types/issueRecurrence';

import { TaskRecurrenceScheduleFields } from './TaskRecurrenceScheduleFields';

/** 지금 반복 상태 줄 — 다음 실행 시각과 꺼짐·멈춤 문구. 반복이 없으면 그리지 않는다. 트리거 아래·편집기 머리에서 같이 쓴다. */
export function TaskRecurrenceStatus({ recurrence, className }: { recurrence: IssueRecurrence | null | undefined; className?: string }) {
  if (!recurrence) return null;
  const paused = recurrencePausedText(recurrence);
  const next = recurrence.enabled ? nextRunText(recurrence.nextRunAt) : null;
  if (!paused && !next) return null;
  return (
    <p className={cn('text-xs', paused ? 'text-warning-text' : 'text-muted-foreground', className)} data-testid="task-recurrence-status">
      {paused ?? next}
    </p>
  );
}

export function TaskRecurrenceEditor({
  projectKey,
  number,
  recurrence,
  onDone,
}: {
  projectKey: string;
  number: number;
  /** 지금 반복(없으면 null) — 폼 초기값. */
  recurrence: IssueRecurrence | null;
  /** 저장·끄기 성공 또는 취소 뒤 부른다(팝오버·시트 닫기). */
  onDone: () => void;
}) {
  const [form, setForm] = useState<TaskRecurrenceForm>(() => parseTaskRRule(recurrence?.rrule, recurrence?.time));
  // 남의 개인 비서 일정은 주인만 바꾼다 — 읽기 전용으로 보이고 후보도 받지 않는다(구버전 서버는 editable 이 없어 고칠 수 있음).
  const editable = recurrence?.editable !== false;
  const agents = useIssueRecurrenceAgents(projectKey, number, editable);
  // 고른 담당 AI — 지금 일정의 AI, 없으면 후보 첫째(내 AI 비서가 맨 앞). 고르기 전에는 후보가 오면 정해진다.
  const [pickedAgentId, setPickedAgentId] = useState<number | null>(recurrence?.agentUserId ?? null);
  const options = agents.data ?? [];
  const agentId = pickedAgentId ?? options[0]?.id ?? null;
  // 고르기 칸의 항목 — 지금 일정의 AI 가 후보에 없으면(구성원에서 빠짐·남의 개인 비서) 이름이라도 보이게 앞에 둔다.
  const agentChoices = [
    ...(recurrence && !options.some((o) => o.id === recurrence.agentUserId)
      ? [{ id: recurrence.agentUserId, label: recurrence.agentName }]
      : []),
    ...options.map((o) => ({ id: o.id, label: agentOptionLabel(o) })),
  ];
  const noAgent = editable && agents.isSuccess && agentChoices.length === 0;
  // 후보를 불러오는 중에는 저장하지 않는다 — 고른 AI 없이 보내면 서버 기본값이 화면에 보이지 않던 AI 로 정해진다.
  const agentPending = editable && agents.isLoading;
  // 저장을 한 번 누른 뒤부터 검사 문구를 보인다(열자마자 빨간 글자가 뜨지 않게).
  const [touched, setTouched] = useState(false);
  const save = useSaveIssueRecurrence(projectKey, number);
  const remove = useDeleteIssueRecurrence(projectKey, number);
  const pending = save.isPending || remove.isPending;
  // 입력 잠금 — 저장 중이거나 남의 개인 비서 일정.
  const locked = pending || !editable;
  const error = validateTaskRecurrence(form);
  const patch = (p: Partial<TaskRecurrenceForm>) => setForm((f) => ({ ...f, ...p }));

  const onSave = () => {
    setTouched(true);
    if (error) return;
    const rrule = buildTaskRRule(form);
    // 반복 안 함으로 저장 — 있던 반복은 끄고, 없었으면 그냥 닫는다.
    if (!rrule) {
      if (recurrence) remove.mutate(undefined, { onSuccess: onDone });
      else onDone();
      return;
    }
    save.mutate({ rrule, time: form.time, agentUserId: agentId ?? undefined }, { onSuccess: onDone });
  };

  return (
    <div className="space-y-3" data-testid="task-recurrence-editor">
      <TaskRecurrenceStatus recurrence={recurrence} />

      {!editable && (
        <p className="text-xs text-muted-foreground" data-testid="task-recurrence-locked">
          {recurrence?.agentName}은(는) 다른 사람의 개인 비서라 주인만 일정을 바꾸거나 끌 수 있어요.
        </p>
      )}

      {/* 담당 AI(WP-1314) — 서버가 실행하는 AI 중에서 고른다. 남의 개인 비서는 후보에 없다. */}
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">담당 AI</span>
        {agents.isError ? (
          <p role="alert" className="text-xs text-destructive">
            맡길 수 있는 AI 를 불러오지 못했어요
          </p>
        ) : noAgent ? (
          <p className="text-xs text-muted-foreground" data-testid="task-recurrence-no-agent">
            맡길 수 있는 AI 가 없어요. 서버가 실행하는 AI 를 프로젝트 구성원으로 넣어 주세요.
          </p>
        ) : (
          <Select
            value={agentId == null ? undefined : String(agentId)}
            onValueChange={(v) => setPickedAgentId(Number(v))}
            disabled={locked || agentPending}
          >
            <SelectTrigger className="h-8 w-full" aria-label="담당 AI" data-testid="task-recurrence-agent">
              <SelectValue placeholder="불러오는 중…" />
            </SelectTrigger>
            <SelectContent>
              {agentChoices.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <TaskRecurrenceScheduleFields form={form} onChange={patch} variant="editor" locked={locked} />

      {touched && error && (
        <p role="alert" className="text-xs text-destructive" data-testid="task-recurrence-error">
          {error}
        </p>
      )}

      {/* 동작·결과 위치 안내 — 설명이 지시라는 것(WP-1310 §4)과, 저장하면 담당 AI 가 담당자에 들어간다는 것. */}
      <p className="text-xs text-muted-foreground">
        설명이 AI 에게 주는 지시가 됩니다. 정한 시각마다 담당 AI 가 이 작업을 하고, 결과는 이 작업의 채팅에 남습니다. 저장하면 담당 AI 가 담당자에 들어가요.
      </p>

      <div className="flex items-center gap-2">
        {recurrence && editable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={locked}
            onClick={() => remove.mutate(undefined, { onSuccess: onDone })}
          >
            일정 끄기
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onDone}>
            {editable ? '취소' : '닫기'}
          </Button>
          {editable && (
            <Button type="button" size="sm" disabled={pending || ((noAgent || agentPending) && form.freq !== 'NONE')} onClick={onSave}>
              저장
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
