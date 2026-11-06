// 실행 일정 입력 칸(WP-989·WP-1315) — 일정 칩(한 번만·매일·평일·매주·매월·몇 시간마다, 편집기는 「안 함」도) + 요일(매주) + 날짜(매월) + 실행 시각(한국 시간).
// 이슈 상세의 「AI 에게 맡기기」 편집기(TaskRecurrenceEditor)와 만들기 창의 「AI 에게 맡기기」(CreateAiHandoffSection)가 같은 칸을 쓴다.
// 폼 상태는 부르는 쪽이 들고 있고, 이 컴포넌트는 그리고 고칠 값만 알린다.
// WP-1373: 「몇 시간마다」 칩 — 고르면 간격(1·2·3·4·6·12시간)·시간대(부터~까지)·요일(기본 월~금)과 실행 시각 미리보기가 펼쳐진다(시안 안 A).
// WP-1413: 순서를 간격(칩 뒤 「시간마다」 한 줄) → 요일 → 「시간대 정하기」 스위치(기본 꺼짐 = 하루 종일) → (켰을 때만) 「[시작] ~ [끝]」 → 미리보기로 바꿨다.
import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  CREATE_FREQS,
  EDITOR_FREQS,
  HOURLY_INTERVALS,
  hourlyPreviewText,
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
  HOURLY: '몇 시간마다',
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

type Weekday = (typeof WEEKDAY_CODES)[number];

/**
 * 칩 줄 배치(WP-1373) — 칩 목록마다 배치를 따로 정한다(칩 개수에서 배치를 짐작하지 않는다 — 칩이 늘거나 줄 때 「몇 시간마다」 칸이 우연히 바뀌지 않게).
 * 편집기(「안 함」 포함 일곱 칸)는 네 칸씩 두 줄에 「몇 시간마다」가 두 칸을 차지해 둘째 줄을 채우고, 만들기 창(여섯 칸)은 세 칸씩 두 줄이다 —
 * 320px 팝오버에서 「몇 시간마다」 글자가 잘리지 않게(시안 안 A).
 */
const CHIP_LAYOUTS = {
  editor: { freqs: EDITOR_FREQS, gridClass: 'grid-cols-4', hourlyClass: 'col-span-2' },
  create: { freqs: CREATE_FREQS, gridClass: 'grid-cols-3', hourlyClass: undefined },
} as const satisfies Record<string, { freqs: TaskRecurrenceFreq[]; gridClass: string; hourlyClass: string | undefined }>;

/**
 * 요일 일곱 칸 토글(매주의 요일·몇 시간마다의 요일이 같이 쓴다) — 고른 요일 목록을 받고, 하나를 누르면 넣거나 뺀 새 목록을 알린다.
 * 버튼 이름은 「월요일」처럼 읽히게 aria-label 을 단다.
 */
function WeekdayToggleGroup({
  value,
  onChange,
  locked,
}: {
  value: readonly Weekday[];
  onChange: (next: Weekday[]) => void;
  locked: boolean;
}) {
  const toggle = (d: Weekday) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  return (
    <div role="group" aria-label="요일" className="grid grid-cols-7 gap-1">
      {WEEKDAY_CODES.map((d) => (
        <button
          key={d}
          type="button"
          aria-label={`${WEEKDAY_SHORT[d]}요일`}
          aria-pressed={value.includes(d)}
          disabled={locked}
          onClick={() => toggle(d)}
          className={cn(toggleClass(value.includes(d)), 'px-0')}
        >
          {WEEKDAY_SHORT[d]}
        </button>
      ))}
    </div>
  );
}

/**
 * 한국 시간 시각 칸 — 실행 시각(「시각」)과 몇 시간마다의 시작·끝 시각(WP-1373)이 같이 쓴다.
 * 폭은 브라우저가 시각 글자에 맞춰 정한다(w-auto) — 고정 128px 는 휴대폰 글자 크기(16px)에서 「01:00 AM」 끝이 시계 아이콘에 가려졌다(WP-1115).
 */
function TimeInput({
  label,
  value,
  onChange,
  locked,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  locked: boolean;
  testId: string;
}) {
  return (
    <Input
      type="time"
      aria-label={label}
      value={value}
      disabled={locked}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-auto"
      data-testid={testId}
    />
  );
}

export function TaskRecurrenceScheduleFields({
  form,
  onChange,
  variant,
  locked = false,
  timeHint,
}: {
  form: TaskRecurrenceForm;
  /** 바꾼 값만 넘긴다(부르는 쪽이 합친다). */
  onChange: (patch: Partial<TaskRecurrenceForm>) => void;
  /** 어느 화면의 칸인지 — 보일 일정 칩과 칩 줄 배치를 정한다(편집기는 「안 함」 포함). */
  variant: keyof typeof CHIP_LAYOUTS;
  locked?: boolean;
  /** 시각 칸 옆에 붙일 글(만들기 창의 「다음 실행 …」 미리보기 등). 없으면 「한국 시간」. */
  timeHint?: React.ReactNode;
}) {
  // 편집 날짜 밖에 함께 반복하는 날짜(API·AI 로 저장된 「1,15」의 15) — 안내·빼기·건너뜀 안내에 쓴다(WP-1117).
  const otherDays = otherMonthDaysOf(form);
  const hourly = form.freq === 'HOURLY';
  const hourlyPreview = hourly ? hourlyPreviewText(form) : null;
  const layout = CHIP_LAYOUTS[variant];
  // 「시간대 정하기」 스위치와 이름표를 잇는 id(WP-1413).
  const windowSwitchId = useId();

  return (
    <div className="space-y-3">
      <span className="block text-xs font-medium text-muted-foreground">실행 일정</span>
      <div role="group" aria-label="실행 일정" className={cn('grid gap-1', layout.gridClass)}>
        {layout.freqs.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={form.freq === f}
            disabled={locked}
            onClick={() => onChange({ freq: f })}
            className={cn(toggleClass(form.freq === f), f === 'HOURLY' && layout.hourlyClass)}
          >
            {FREQ_LABEL[f]}
          </button>
        ))}
      </div>

      {form.freq === 'WEEKLY' && <WeekdayToggleGroup value={form.byDay} onChange={(byDay) => onChange({ byDay })} locked={locked} />}

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

      {hourly && (
        <div className="space-y-3" data-testid="task-recurrence-hourly">
          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">간격</span>
            {/* 간격 칩 뒤에 「시간마다」를 붙여 한 문장으로 읽히게 한다(WP-1413 시안). */}
            <div className="flex items-center gap-2">
              <div role="group" aria-label="간격" className="grid min-w-0 flex-1 grid-cols-6 gap-1">
                {HOURLY_INTERVALS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n}시간마다`}
                    aria-pressed={form.interval === n}
                    disabled={locked}
                    onClick={() => onChange({ interval: n })}
                    className={cn(toggleClass(form.interval === n), 'px-0')}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="shrink-0 text-sm">시간마다</span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="block text-xs font-medium text-muted-foreground">요일</span>
            {/* 몇 시간마다의 요일 — 매주의 요일(byDay)과 따로 든다(WP-1373). */}
            <WeekdayToggleGroup value={form.hourlyDays} onChange={(hourlyDays) => onChange({ hourlyDays })} locked={locked} />
          </div>

          {/* 시간대(WP-1413) — 기본은 꺼짐(하루 종일, 자정부터 간격마다). 켰을 때만 시작·끝 칸이 나온다. 끄더라도 입력했던 시각은 폼에 남아
              창이 열려 있는 동안 다시 켜면 되살아난다(저장은 꺼짐이면 00:00~23:59). */}
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={windowSwitchId} className="text-sm font-medium">
              시간대 정하기
            </label>
            <Switch
              id={windowSwitchId}
              checked={form.hourlyWindow}
              onCheckedChange={(hourlyWindow) => onChange({ hourlyWindow })}
              disabled={locked}
              data-testid="task-recurrence-window-switch"
            />
          </div>

          {/* 시간대 — 시작 시각(form.time)에 첫 회차, 간격마다 끝 시각 이하인 회차만 돈다. 자정을 넘는 시간대는 검사 문구로 막는다. */}
          {form.hourlyWindow && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <TimeInput
                label="시작 시각 (한국 시간)"
                value={form.time}
                onChange={(time) => onChange({ time })}
                locked={locked}
                testId="task-recurrence-start"
              />
              <span className="shrink-0" aria-hidden>
                ~
              </span>
              <TimeInput
                label="끝 시각 (한국 시간)"
                value={form.untilTime}
                onChange={(untilTime) => onChange({ untilTime })}
                locked={locked}
                testId="task-recurrence-until"
              />
            </div>
          )}

          {/* 실행 시각 미리보기 — 시간대가 틀려 회차를 정할 수 없으면 그리지 않는다(검사 문구가 따로 알린다). */}
          {hourlyPreview && (
            <p className="text-xs text-muted-foreground" data-testid="task-recurrence-hourly-preview">
              {hourlyPreview}
            </p>
          )}
          {/* 시각 칸이 따로 없으므로 시간 기준(만들기 창은 「다음 실행 …」 미리보기)을 여기에 보인다. */}
          <p className="text-xs text-muted-foreground">{timeHint ?? '한국 시간'}</p>
        </div>
      )}

      {form.freq !== 'NONE' && !hourly && (
        <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="shrink-0 text-muted-foreground">시각</span>
          <TimeInput
            label="실행 시각 (한국 시간)"
            value={form.time}
            onChange={(time) => onChange({ time })}
            locked={locked}
            testId="task-recurrence-time"
          />
          <span className="shrink-0 text-xs text-muted-foreground">{timeHint ?? '한국 시간'}</span>
        </label>
      )}
    </div>
  );
}
