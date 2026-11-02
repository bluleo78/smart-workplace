// 실행 일정 입력 칸(WP-989·WP-1315) — 일정 칩(한 번만·매일·평일·매주·매월, 편집기는 「안 함」도) + 요일(매주) + 날짜(매월) + 실행 시각(한국 시간).
// 이슈 상세의 「AI 에게 맡기기」 편집기(TaskRecurrenceEditor)와 만들기 창의 「AI 에게 맡기기」(CreateAiHandoffSection)가 같은 칸을 쓴다.
// 폼 상태는 부르는 쪽이 들고 있고, 이 컴포넌트는 그리고 고칠 값만 알린다.
import { Input } from '@/components/ui/input';
import {
  monthDayMaySkip,
  otherMonthDaysOf,
  type TaskRecurrenceForm,
  type TaskRecurrenceFreq,
  WEEKDAY_CODES,
  WEEKDAY_SHORT,
} from '@/lib/issueRecurrence';
import { cn } from '@/lib/utils';

/** 일정 칩 이름 — 칸 위 「실행 일정」 이름표가 맥락을 주므로 짧게. */
const FREQ_LABEL: Record<TaskRecurrenceFreq, string> = {
  NONE: '안 함',
  ONCE: '한 번만',
  DAILY: '매일',
  WEEKDAYS: '평일',
  WEEKLY: '매주',
  MONTHLY: '매월',
};

/**
 * 눌림 토글 버튼 공통 모양 — 켜지면 primary 채움, 아니면 윤곽.
 * 휴대폰 폭(다섯 칸 한 줄)에서 「한 번만」이 두 줄로 꺾이지 않게 줄바꿈을 막고 좌우 여백을 줄인다(WP-1315 라이브 확인).
 */
const toggleClass = (on: boolean) =>
  cn(
    'inline-flex h-8 items-center justify-center whitespace-nowrap rounded-md border px-1 text-sm transition-colors disabled:opacity-60',
    on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent',
  );

export function TaskRecurrenceScheduleFields({
  form,
  onChange,
  freqs,
  locked = false,
  timeHint,
}: {
  form: TaskRecurrenceForm;
  /** 바꾼 값만 넘긴다(부르는 쪽이 합친다). */
  onChange: (patch: Partial<TaskRecurrenceForm>) => void;
  /** 보일 일정 칩(순서대로). */
  freqs: TaskRecurrenceFreq[];
  locked?: boolean;
  /** 시각 칸 옆에 붙일 글(만들기 창의 「다음 실행 …」 미리보기 등). 없으면 「한국 시간」. */
  timeHint?: React.ReactNode;
}) {
  // 편집 날짜 밖에 함께 반복하는 날짜(API·AI 로 저장된 「1,15」의 15) — 안내·빼기·건너뜀 안내에 쓴다(WP-1117).
  const otherDays = otherMonthDaysOf(form);
  const toggleDay = (d: (typeof WEEKDAY_CODES)[number]) =>
    onChange({ byDay: form.byDay.includes(d) ? form.byDay.filter((x) => x !== d) : [...form.byDay, d] });

  return (
    <div className="space-y-3">
      <span className="block text-xs font-medium text-muted-foreground">실행 일정</span>
      {/* 다섯 칸은 한 줄, 여섯 칸(편집기 — 「안 함」 포함)은 세 칸씩 두 줄로 — 320px 팝오버에서 글자가 잘리지 않게. */}
      <div role="group" aria-label="실행 일정" className={cn('grid gap-1', freqs.length > 5 ? 'grid-cols-3' : 'grid-cols-5')}>
        {freqs.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={form.freq === f}
            disabled={locked}
            onClick={() => onChange({ freq: f })}
            className={toggleClass(form.freq === f)}
          >
            {FREQ_LABEL[f]}
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
              disabled={locked}
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
              disabled={locked}
              onChange={(e) => onChange({ monthDay: e.target.value === '' ? NaN : Number(e.target.value) })}
              className="h-8 w-20"
            />
            <span className="shrink-0">일</span>
          </label>
          {/* API·AI 로 저장된 여러 날짜 — 편집기는 날짜 하나만 고치고 나머지는 저장 때 그대로 둔다는 것을 알리고,
              나머지를 빼고 편집 날짜만 남길 수 있게 한다(WP-1117). */}
          {otherDays.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" data-testid="task-recurrence-other-monthdays">
              <span>{otherDays.join('·')}일에도 반복합니다</span>
              {Number.isInteger(form.monthDay) && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onChange({ otherMonthDays: [] })}
                  className="text-primary underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {form.monthDay}일만 반복
                </button>
              )}
            </p>
          )}
          {/* 29~31일 — 서버는 RFC 5545 대로 그 날짜가 없는 달(2월·30일까지인 달)을 건너뛴다. */}
          {[form.monthDay, ...otherDays].some(monthDayMaySkip) && (
            <p className="text-xs text-muted-foreground" data-testid="task-recurrence-monthday-hint">
              그 날짜가 없는 달은 건너뜁니다
            </p>
          )}
        </div>
      )}

      {form.freq !== 'NONE' && (
        <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="shrink-0 text-muted-foreground">시각</span>
          <Input
            type="time"
            aria-label="실행 시각 (한국 시간)"
            value={form.time}
            disabled={locked}
            onChange={(e) => onChange({ time: e.target.value })}
            // 폭은 브라우저가 시각 글자에 맞춰 정한다(w-auto) — 고정 128px 는 휴대폰 글자 크기(16px)에서 「01:00 AM」 끝이 시계 아이콘에
            // 가려졌다(WP-1115).
            className="h-8 w-auto"
            data-testid="task-recurrence-time"
          />
          <span className="shrink-0 text-xs text-muted-foreground">{timeHint ?? '한국 시간'}</span>
        </label>
      )}
    </div>
  );
}
