// 개인 작업 반복 편집기(WP-989) — 데스크톱 팝오버와 모바일 바텀시트가 같은 본문을 쓴다.
// 반복 안 함 / 매일 / 매주(요일 여러 개, 하나 이상) / 매월(1~31일) + 실행 시각(한국 시간 HH:mm).
// 저장 = PUT(반복 안 함으로 저장하면 기존 반복을 끈다), 「반복 끄기」 = DELETE. 저장하면 서버가 내 AI 비서를 담당에 넣는다.
// 409(쓸 수 있는 AI 비서 없음·완료된 작업 등)는 훅의 handleApiError 가 토스트로 보인다.
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDeleteIssueRecurrence, useSaveIssueRecurrence } from '@/hooks/queries/useIssueRecurrence';
import {
  buildTaskRRule,
  monthDayMaySkip,
  nextRunText,
  parseTaskRRule,
  recurrencePausedText,
  type TaskRecurrenceForm,
  validateTaskRecurrence,
  WEEKDAY_CODES,
  WEEKDAY_SHORT,
} from '@/lib/issueRecurrence';
import type { RecurrenceFreq } from '@/lib/recurrence';
import { cn } from '@/lib/utils';
import type { IssueRecurrence } from '@/types/issueRecurrence';

const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  // 네 칸 한 줄에 들어가게 짧게 — 칸 위 「반복」 이름표가 맥락을 준다(트리거는 「반복 안 함」 그대로).
  { value: 'NONE', label: '안 함' },
  { value: 'DAILY', label: '매일' },
  { value: 'WEEKLY', label: '매주' },
  { value: 'MONTHLY', label: '매월' },
];

/** 눌림 토글 버튼 공통 모양 — 켜지면 primary 채움, 아니면 윤곽. */
const toggleClass = (on: boolean) =>
  cn(
    'inline-flex h-8 items-center justify-center rounded-md border px-2 text-sm transition-colors disabled:opacity-60',
    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent',
  );

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
  // 저장을 한 번 누른 뒤부터 검사 문구를 보인다(열자마자 빨간 글자가 뜨지 않게).
  const [touched, setTouched] = useState(false);
  const save = useSaveIssueRecurrence(projectKey, number);
  const remove = useDeleteIssueRecurrence(projectKey, number);
  const pending = save.isPending || remove.isPending;
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
    save.mutate({ rrule, time: form.time }, { onSuccess: onDone });
  };

  const toggleDay = (d: (typeof WEEKDAY_CODES)[number]) =>
    patch({ byDay: form.byDay.includes(d) ? form.byDay.filter((x) => x !== d) : [...form.byDay, d] });

  return (
    <div className="space-y-3" data-testid="task-recurrence-editor">
      <TaskRecurrenceStatus recurrence={recurrence} />

      <div role="group" aria-label="반복 주기" className="grid grid-cols-4 gap-1">
        {FREQ_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={form.freq === o.value}
            disabled={pending}
            onClick={() => patch({ freq: o.value })}
            className={toggleClass(form.freq === o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {form.freq === 'WEEKLY' && (
        <div role="group" aria-label="요일" className="grid grid-cols-7 gap-1">
          {WEEKDAY_CODES.map((d) => (
            <button
              key={d}
              type="button"
              aria-label={`${WEEKDAY_SHORT[d]}요일`}
              aria-pressed={form.byDay.includes(d)}
              disabled={pending}
              onClick={() => toggleDay(d)}
              className={cn(toggleClass(form.byDay.includes(d)), 'px-0')}
            >
              {WEEKDAY_SHORT[d]}
            </button>
          ))}
        </div>
      )}

      {form.freq === 'MONTHLY' && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">매월</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              aria-label="날짜"
              value={Number.isFinite(form.monthDay) ? form.monthDay : ''}
              disabled={pending}
              onChange={(e) => patch({ monthDay: e.target.value === '' ? NaN : Number(e.target.value) })}
              className="h-8 w-20"
            />
            <span className="shrink-0">일</span>
          </label>
          {/* 29~31일 — 서버는 RFC 5545 대로 그 날짜가 없는 달(2월·30일까지인 달)을 건너뛴다. */}
          {monthDayMaySkip(form.monthDay) && (
            <p className="text-xs text-muted-foreground" data-testid="task-recurrence-monthday-hint">
              그 날짜가 없는 달은 건너뜁니다
            </p>
          )}
        </div>
      )}

      {form.freq !== 'NONE' && (
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">시각</span>
          <Input
            type="time"
            aria-label="실행 시각 (한국 시간)"
            value={form.time}
            disabled={pending}
            onChange={(e) => patch({ time: e.target.value })}
            // 폭은 브라우저가 시각 글자에 맞춰 정한다(w-auto) — 고정 128px 는 휴대폰 글자 크기(16px)에서 「01:00 AM」 끝이 시계 아이콘에
            // 가려졌다(WP-1115).
            className="h-8 w-auto"
            data-testid="task-recurrence-time"
          />
          <span className="shrink-0 text-xs text-muted-foreground">한국 시간</span>
        </label>
      )}

      {touched && error && (
        <p role="alert" className="text-xs text-destructive" data-testid="task-recurrence-error">
          {error}
        </p>
      )}

      {/* 반복의 동작·결과 위치 안내 — 개인 작업은 사용자가 AI 비서를 담당에 직접 넣을 수 없어 서버가 저장 때 넣는다. */}
      <p className="text-xs text-muted-foreground">
        반복을 켜면 내 AI 비서가 담당에 들어가요. 정한 시각마다 AI 비서가 이 작업을 하고, 결과는 이 작업의 채팅에 남습니다.
      </p>

      <div className="flex items-center gap-2">
        {recurrence && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => remove.mutate(undefined, { onSuccess: onDone })}
          >
            반복 끄기
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onDone}>
            취소
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={onSave}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
