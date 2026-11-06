// 개인 작업 반복(WP-989) 순수 함수 — 폼 ↔ RRULE 왕복, 검사 문구, 요약·다음 실행·멈춤 문구.
import { describe, expect, test } from 'vitest'

import {
  agentOptionLabel,
  aiHandoffLabel,
  aiHandoffParts,
  buildTaskRRule,
  createHandoffSummary,
  DEFAULT_TASK_RECURRENCE_FORM,
  hourlyPreviewText,
  hourlyRunTimes,
  isOnceRule,
  kstShortDateTime,
  monthDayMaySkip,
  nextRunText,
  onceDateFor,
  otherMonthDaysOf,
  parseTaskRRule,
  previewNextRun,
  recurrenceLabel,
  recurrencePausedText,
  runNowState,
  taskRunTime,
  validateTaskRecurrence,
} from './issueRecurrence'

const form = (o: Partial<typeof DEFAULT_TASK_RECURRENCE_FORM>) => ({ ...DEFAULT_TASK_RECURRENCE_FORM, ...o })

describe('buildTaskRRule', () => {
  test('반복 안 함은 null, 매일은 FREQ=DAILY', () => {
    expect(buildTaskRRule(form({ freq: 'NONE' }))).toBeNull()
    expect(buildTaskRRule(form({ freq: 'DAILY' }))).toBe('FREQ=DAILY')
  })
  test('매주는 요일을 월~일 순으로 정렬해 BYDAY 로', () => {
    expect(buildTaskRRule(form({ freq: 'WEEKLY', byDay: ['WE', 'MO'] }))).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
  })
  test('매월은 BYMONTHDAY', () => {
    expect(buildTaskRRule(form({ freq: 'MONTHLY', monthDay: 15 }))).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
  })
})

describe('parseTaskRRule', () => {
  test('없으면 반복 안 함 기본값, 시각만 옮긴다', () => {
    expect(parseTaskRRule(null)).toEqual(DEFAULT_TASK_RECURRENCE_FORM)
    expect(parseTaskRRule(null, '07:15').time).toBe('07:15')
  })
  test('매주·매월 규칙을 폼으로 되읽는다(왕복)', () => {
    const w = parseTaskRRule('FREQ=WEEKLY;BYDAY=WE,MO', '08:30')
    expect(w).toEqual({ ...DEFAULT_TASK_RECURRENCE_FORM, freq: 'WEEKLY', byDay: ['MO', 'WE'], time: '08:30' })
    expect(buildTaskRRule(w)).toBe('FREQ=WEEKLY;BYDAY=MO,WE')
    const m = parseTaskRRule('FREQ=MONTHLY;BYMONTHDAY=31', '23:59')
    expect(m.freq).toBe('MONTHLY')
    expect(m.monthDay).toBe(31)
  })
  test('매월 여러 날짜는 첫 날짜를 편집 날짜로, 나머지를 함께 읽어 그대로 저장한다(WP-1117)', () => {
    const m = parseTaskRRule('FREQ=MONTHLY;BYMONTHDAY=1,15', '09:00')
    expect(m.monthDay).toBe(1)
    expect(m.otherMonthDays).toEqual([15])
    expect(buildTaskRRule(m)).toBe('FREQ=MONTHLY;BYMONTHDAY=1,15')
    // 편집 날짜를 바꿔도 나머지 날짜는 남고, 나머지와 같은 날짜로 바꾸면 겹치지 않는다.
    expect(buildTaskRRule({ ...m, monthDay: 20 })).toBe('FREQ=MONTHLY;BYMONTHDAY=15,20')
    expect(buildTaskRRule({ ...m, monthDay: 15 })).toBe('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(otherMonthDaysOf({ ...m, monthDay: 15 })).toEqual([])
  })
  test('지원하지 않는 FREQ 는 반복 안 함', () => {
    expect(parseTaskRRule('FREQ=YEARLY').freq).toBe('NONE')
  })
})

describe('validateTaskRecurrence', () => {
  test('반복 안 함·정상 값은 통과', () => {
    expect(validateTaskRecurrence(form({ freq: 'NONE', byDay: [] }))).toBeNull()
    expect(validateTaskRecurrence(form({ freq: 'WEEKLY', byDay: ['FR'], time: '08:30' }))).toBeNull()
  })
  test('매주 요일 없음 · 매월 날짜 범위 밖 · 시각 형식', () => {
    expect(validateTaskRecurrence(form({ freq: 'WEEKLY', byDay: [] }))).toBe('요일을 하나 이상 고르세요')
    expect(validateTaskRecurrence(form({ freq: 'MONTHLY', monthDay: 32 }))).toBe('날짜는 1일부터 31일 사이로 고르세요')
    expect(validateTaskRecurrence(form({ freq: 'MONTHLY', monthDay: 0 }))).toBe('날짜는 1일부터 31일 사이로 고르세요')
    expect(validateTaskRecurrence(form({ freq: 'DAILY', time: '24:00' }))).toBe('시각을 HH:mm 으로 입력하세요')
    expect(validateTaskRecurrence(form({ freq: 'DAILY', time: '' }))).toBe('시각을 HH:mm 으로 입력하세요')
  })
})

describe('recurrenceLabel', () => {
  test('매일·매주·매월 요약', () => {
    expect(recurrenceLabel('FREQ=DAILY', '08:30')).toBe('매일 08:30')
    expect(recurrenceLabel('FREQ=WEEKLY;BYDAY=MO,WE', '08:30')).toBe('매주 월·수 08:30')
    expect(recurrenceLabel('FREQ=MONTHLY;BYMONTHDAY=15', '08:30')).toBe('매월 15일 08:30')
  })
  test('BYMONTHDAY 가 여러 날짜면 「매월 1·15일」, 범위 밖이 섞이면 원문', () => {
    expect(recurrenceLabel('FREQ=MONTHLY;BYMONTHDAY=15,1', '08:30')).toBe('매월 1·15일 08:30')
    expect(recurrenceLabel('FREQ=MONTHLY;BYMONTHDAY=1,40', '08:30')).toBe('FREQ=MONTHLY;BYMONTHDAY=1,40 08:30')
    expect(parseTaskRRule('FREQ=MONTHLY;BYMONTHDAY=15,1').monthDay).toBe(1)
  })
  test('읽을 수 없는 규칙은 원문 그대로', () => {
    expect(recurrenceLabel('FREQ=YEARLY', '08:30')).toBe('FREQ=YEARLY 08:30')
  })
})

describe('monthDayMaySkip', () => {
  test('29~31일만 「없는 달」이 있다', () => {
    expect([28, 29, 30, 31].map(monthDayMaySkip)).toEqual([false, true, true, true])
  })
})

describe('nextRunText', () => {
  test('한국 시간으로 「다음 실행 M/D(요일) HH:mm」', () => {
    expect(nextRunText('2026-10-28T23:30:00Z')).toBe('다음 실행 10/29(목) 08:30')
    expect(nextRunText('2026-10-29T08:30:00+09:00')).toBe('다음 실행 10/29(목) 08:30')
  })
  test('없거나 읽을 수 없으면 null', () => {
    expect(nextRunText(null)).toBeNull()
    expect(nextRunText('nope')).toBeNull()
  })
})

describe('recurrencePausedText', () => {
  test('켜짐 null · 3회 이상 실패 멈춤 · 그 밖 꺼짐', () => {
    expect(recurrencePausedText({ enabled: true, consecutiveFailures: 5 })).toBeNull()
    expect(recurrencePausedText({ enabled: false, consecutiveFailures: 3 })).toBe('멈춤 — 3회 연속 실패')
    expect(recurrencePausedText({ enabled: false, consecutiveFailures: 1 })).toBe('꺼짐')
    expect(recurrencePausedText({ enabled: false })).toBe('꺼짐')
  })
})

// WP-1314: 「AI 에게 맡기기」 요약과 담당 AI 후보 이름.
describe('aiHandoffLabel', () => {
  test('담당 AI · ↻ 일정, 없으면 「안 함」', () => {
    expect(aiHandoffLabel({ rrule: 'FREQ=WEEKLY;BYDAY=MO,FR', time: '08:30', agentName: '내 비서' })).toBe('내 비서 · ↻ 매주 월·금 08:30')
    expect(aiHandoffLabel(null)).toBe('안 함')
  })
})

describe('agentOptionLabel', () => {
  test('내 개인 비서 표시 · 이름이 비면 username', () => {
    expect(agentOptionLabel({ name: '도우미', username: 'a', personalAssistant: true })).toBe('도우미 (내 AI 비서)')
    expect(agentOptionLabel({ name: ' ', username: 'team-ai', personalAssistant: false })).toBe('team-ai')
  })
})

// WP-1313: 「지금 실행」 버튼 판정 — 서버 규칙(남의 개인 비서는 주인만, 실행은 하나씩)과 같고, 막힌 이유를 돌려준다.
describe('runNowState', () => {
  const r = { agentName: '비서', editable: true, testRunning: false }
  test('일정이 없으면 그리지 않는다', () => {
    expect(runNowState(null, false, false).visible).toBe(false)
  })
  test('고칠 수 있고 실행 중이 아니면 누를 수 있다', () => {
    expect(runNowState(r, false, false)).toEqual({ visible: true, disabled: false, reason: null, running: false })
    // 구버전 서버(editable·testRunning 없음)도 누를 수 있다.
    expect(runNowState({}, false, false).disabled).toBe(false)
  })
  test('남의 개인 비서 일정은 주인만 — 읽기 전용·실행 중보다 먼저 그 이유를 보인다', () => {
    const s = runNowState({ ...r, editable: false, testRunning: true }, true, false)
    expect(s.disabled).toBe(true)
    expect(s.reason).toBe('다른 사람의 개인 비서 일정이라 그 주인만 실행할 수 있어요')
  })
  test('읽기 전용 이슈는 잠근다', () => {
    expect(runNowState(r, true, false).reason).toContain('고칠 수 있는 사람만')
  })
  test('결과를 기다리거나 요청 중이면 「실행 중」으로 잠근다', () => {
    expect(runNowState({ ...r, testRunning: true }, false, false)).toMatchObject({ disabled: true, running: true })
    expect(runNowState(r, false, true)).toMatchObject({ disabled: true, running: true })
  })
})

// WP-1315: 「한 번만」(FREQ=ONCE;DATE=…)·「평일」 칩과 만들기 창의 다음 실행 미리보기.
describe('한 번만·평일 (WP-1315)', () => {
  // 2026-11-02(월) 23:00Z = 11/3(화) 08:00 KST.
  const NOW = new Date('2026-11-02T23:00:00Z')

  test('한 번만 날짜는 그 시각이 아직 안 지났으면 오늘, 지났으면(같은 분 포함) 내일 — 서버 resolveOnce 와 같다', () => {
    expect(onceDateFor('08:30', NOW)).toBe('2026-11-03')
    expect(onceDateFor('08:00', NOW)).toBe('2026-11-04')
    expect(onceDateFor('07:59', NOW)).toBe('2026-11-04')
    expect(onceDateFor('8:00', NOW)).toBeNull()
  })

  test('한 번만은 날짜 없이 보내고, 저장된 날짜가 아직 오지 않았으면 그대로 둔다', () => {
    expect(buildTaskRRule(form({ freq: 'ONCE', time: '08:30' }), NOW)).toBe('FREQ=ONCE')
    expect(buildTaskRRule(form({ freq: 'ONCE', time: '09:00', onceDate: '2026-11-05' }), NOW)).toBe('FREQ=ONCE;DATE=2026-11-05')
    // 지난 날짜(이미 실행한 예약)는 빼서 서버가 새 때로 정하게 한다.
    expect(buildTaskRRule(form({ freq: 'ONCE', time: '07:00', onceDate: '2026-11-03' }), NOW)).toBe('FREQ=ONCE')
  })

  test('평일은 매주 월~금 규칙으로 저장하고, 월~금 규칙은 평일로 되읽는다', () => {
    expect(buildTaskRRule(form({ freq: 'WEEKDAYS' }))).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(parseTaskRRule('FREQ=WEEKLY;BYDAY=FR,TH,WE,TU,MO', '08:30').freq).toBe('WEEKDAYS')
    // 월~토는 평일이 아니다.
    expect(parseTaskRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA').freq).toBe('WEEKLY')
  })

  test('한 번만 규칙을 폼으로 되읽는다', () => {
    const f = parseTaskRRule('FREQ=ONCE;DATE=2026-11-05', '09:00')
    expect(f.freq).toBe('ONCE')
    expect(f.onceDate).toBe('2026-11-05')
    expect(isOnceRule('FREQ=ONCE;DATE=2026-11-05')).toBe(true)
    expect(isOnceRule('FREQ=DAILY')).toBe(false)
  })

  test('요약 문구 — 한 번만 11/3(화) 08:30, 평일 08:30', () => {
    expect(recurrenceLabel('FREQ=ONCE;DATE=2026-11-03', '08:30')).toBe('한 번만 11/3(화) 08:30')
    expect(recurrenceLabel('FREQ=ONCE', '08:30')).toBe('한 번만 08:30')
    expect(recurrenceLabel('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '08:30')).toBe('평일 08:30')
    // 한 번만은 되풀이가 아니라 ↻ 를 붙이지 않는다.
    expect(aiHandoffLabel({ rrule: 'FREQ=ONCE;DATE=2026-11-03', time: '08:30', agentName: '내 비서' })).toBe('내 비서 · 한 번만 11/3(화) 08:30')
    expect(aiHandoffLabel({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', time: '08:30', agentName: '내 비서' })).toBe('내 비서 · ↻ 평일 08:30')
  })

  test('실행을 마친 한 번만은 성공이면 「실행함」, 실패·무응답이면 「실패함」', () => {
    expect(recurrencePausedText({ enabled: false, consecutiveFailures: 0, rrule: 'FREQ=ONCE;DATE=2026-11-03' })).toBe('실행함')
    expect(recurrencePausedText({ enabled: false, rrule: 'FREQ=ONCE;DATE=2026-11-03' })).toBe('실행함')
    // 서버는 한 번만 회차가 실패하거나 결과가 오지 않으면(LOST_RUN) consecutiveFailures=1 로 끈다 — 성공처럼 보이면 안 된다(PR #1147 리뷰).
    const failed = recurrencePausedText({ enabled: false, consecutiveFailures: 1, rrule: 'FREQ=ONCE;DATE=2026-11-03' })
    expect(failed).toBe('실패함 — 실행이 실패했거나 결과가 오지 않았습니다')
    // 작업 행 표식·모바일 칩은 첫 낱말만 쓴다.
    expect(failed?.split(' ')[0]).toBe('실패함')
    expect(recurrencePausedText({ enabled: true, rrule: 'FREQ=ONCE;DATE=2026-11-03' })).toBeNull()
  })

  test('다음 실행 미리보기 — 서버 다음 회차 계산과 같은 규칙(한국 시간, 지금 뒤의 첫 회차)', () => {
    const at = (f: Parameters<typeof previewNextRun>[0]) => {
      const d = previewNextRun(f, NOW)
      return d ? kstShortDateTime(d) : null
    }
    expect(at(form({ freq: 'ONCE', time: '08:30' }))).toBe('11/3(화) 08:30')
    expect(at(form({ freq: 'ONCE', time: '08:00' }))).toBe('11/4(수) 08:00')
    expect(at(form({ freq: 'ONCE', time: '09:00', onceDate: '2026-11-10' }))).toBe('11/10(화) 09:00')
    expect(at(form({ freq: 'DAILY', time: '07:00' }))).toBe('11/4(수) 07:00')
    expect(at(form({ freq: 'WEEKDAYS', time: '08:30' }))).toBe('11/3(화) 08:30')
    expect(at(form({ freq: 'WEEKLY', byDay: ['SU'], time: '10:00' }))).toBe('11/8(일) 10:00')
    expect(at(form({ freq: 'MONTHLY', monthDay: 1, time: '09:00' }))).toBe('12/1(화) 09:00')
    // 11월은 31일이 없어 12월 31일.
    expect(at(form({ freq: 'MONTHLY', monthDay: 31, time: '09:00' }))).toBe('12/31(목) 09:00')
    // 금요일 08:30 KST 뒤의 평일은 다음 주 월요일.
    const fri = new Date('2026-11-06T00:00:00Z')
    expect(kstShortDateTime(previewNextRun(form({ freq: 'WEEKDAYS', time: '08:30' }), fri)!)).toBe('11/9(월) 08:30')
    // 안 함·검사 실패는 null.
    expect(previewNextRun(form({ freq: 'NONE' }), NOW)).toBeNull()
    expect(previewNextRun(form({ freq: 'WEEKLY', byDay: [] }), NOW)).toBeNull()
  })
})

describe('createHandoffSummary (WP-1315)', () => {
  const NOW = new Date('2026-11-02T23:00:00Z')
  const mine = { name: '도우미', username: 'my-ai', personalAssistant: true }
  test('내 비서는 「내 AI 비서」, 한 번만은 ↻ 없이 미리보기 날짜, 담당 AI 가 없으면 「안 함」', () => {
    expect(createHandoffSummary(mine, form({ freq: 'WEEKDAYS', time: '08:30' }), NOW)).toBe('내 AI 비서 · ↻ 평일 08:30')
    expect(createHandoffSummary(mine, form({ freq: 'ONCE', time: '08:30' }), NOW)).toBe('내 AI 비서 · 한 번만 11/3(화) 08:30')
    expect(createHandoffSummary({ name: null, username: 'team-ai', personalAssistant: false }, form({ freq: 'DAILY' }), NOW)).toBe('team-ai · ↻ 매일 09:00')
    expect(createHandoffSummary(null, form({ freq: 'DAILY' }), NOW)).toBe('안 함')
  })
})

// WP-1373: 「몇 시간마다」(FREQ=HOURLY;INTERVAL=n;BYDAY=..;UNTILTIME=HH:mm) — 시작 시각(time)부터 간격마다, 끝 시각 이하인 회차만.
describe('몇 시간마다 (WP-1373)', () => {
  // 시간대를 정한(스위치 켬, WP-1413) 몇 시간마다 — 기존 단언이 09~18시 시간대의 뜻을 그대로 갖게.
  const hourly = (o: Partial<typeof DEFAULT_TASK_RECURRENCE_FORM> = {}) => form({ freq: 'HOURLY', time: '09:00', hourlyWindow: true, ...o })

  test('저장 모양은 서버가 정규화하는 순서와 같고, 되읽으면 같은 폼이다(왕복)', () => {
    const rrule = buildTaskRRule(hourly({ interval: 3, hourlyDays: ['WE', 'MO'], untilTime: '18:00' }))
    expect(rrule).toBe('FREQ=HOURLY;INTERVAL=3;BYDAY=MO,WE;UNTILTIME=18:00')
    const back = parseTaskRRule(rrule, '09:30')
    expect(back).toMatchObject({ freq: 'HOURLY', interval: 3, hourlyDays: ['MO', 'WE'], untilTime: '18:00', time: '09:30', hourlyWindow: true })
    // 몇 시간마다의 요일은 매주 요일(byDay)과 따로 — 매주 기본값은 그대로다.
    expect(back.byDay).toEqual(DEFAULT_TASK_RECURRENCE_FORM.byDay)
    expect(buildTaskRRule(back)).toBe(rrule)
    expect(buildTaskRRule(hourly())).toBe('FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=18:00')
    // WP-1413: 새 몇 시간마다의 기본값은 시간대 꺼짐(하루 종일) — 평일 2시간마다, 00:00 부터 23:59 까지로 저장한다.
    const fresh = form({ freq: 'HOURLY' })
    expect(fresh.hourlyWindow).toBe(false)
    expect(buildTaskRRule(fresh)).toBe('FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=23:59')
    expect(taskRunTime(fresh)).toBe('00:00')
  })

  test('요일이 비었거나 읽을 수 없는 부분이 있는 규칙은 월~금 등 기본값으로 채우지 않고 모르는 규칙처럼 다룬다', () => {
    const unknown = parseTaskRRule('FREQ=YEARLY', '09:00')
    for (const rrule of [
      'FREQ=HOURLY;INTERVAL=2;UNTILTIME=18:00', // 요일 없음
      'FREQ=HOURLY;INTERVAL=2;BYDAY=;UNTILTIME=18:00', // 빈 요일
      'FREQ=HOURLY;INTERVAL=2;BYDAY=MO,XX;UNTILTIME=18:00', // 모르는 요일
      'FREQ=HOURLY;INTERVAL=2;BYDAY=MO,MO;UNTILTIME=18:00', // 겹친 요일
      'FREQ=HOURLY;INTERVAL=5;BYDAY=MO;UNTILTIME=18:00', // 고를 수 없는 간격
      'FREQ=HOURLY;INTERVAL=2;BYDAY=MO', // 끝 시각 없음
      'FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=1800', // 끝 시각 형식
      'FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=18:00;BYMONTHDAY=1', // 모르는 항목
    ]) {
      const f = parseTaskRRule(rrule, '09:00')
      expect(f, rrule).toEqual(unknown)
      expect(f.freq, rrule).toBe('NONE')
      // 요약은 원문 그대로 — 뜻을 지어내지 않는다.
      expect(recurrenceLabel(rrule, '09:00'), rrule).toBe(`${rrule} 09:00`)
    }
    // 간격이 빠진 것만은 1시간마다로 읽는다(서버 정규화와 같다).
    expect(parseTaskRRule('FREQ=HOURLY;BYDAY=SA;UNTILTIME=12:00', '09:00')).toMatchObject({ freq: 'HOURLY', interval: 1, hourlyDays: ['SA'] })
  })

  test('하루 실행 시각은 시작부터 간격마다, 끝 시각 정각 포함', () => {
    expect(hourlyRunTimes(hourly())).toEqual(['09:00', '11:00', '13:00', '15:00', '17:00'])
    expect(hourlyRunTimes(hourly({ untilTime: '17:00' }))).toEqual(['09:00', '11:00', '13:00', '15:00', '17:00'])
    expect(hourlyRunTimes(hourly({ interval: 3, untilTime: '17:30' }))).toEqual(['09:00', '12:00', '15:00'])
    expect(hourlyRunTimes(hourly({ time: '09:30', interval: 4, untilTime: '18:00' }))).toEqual(['09:30', '13:30', '17:30'])
    // 끝이 시작 이하(자정 넘김)·몇 시간마다가 아니면 빈 목록.
    expect(hourlyRunTimes(hourly({ time: '22:00', untilTime: '02:00' }))).toEqual([])
    expect(hourlyRunTimes(hourly({ untilTime: '09:00' }))).toEqual([])
    expect(hourlyRunTimes(form({ freq: 'DAILY' }))).toEqual([])
  })

  test('미리보기 문구 — 시각 목록과 하루 횟수, 많으면 줄인다', () => {
    expect(hourlyPreviewText(hourly())).toBe('09:00 · 11:00 · 13:00 · 15:00 · 17:00 에 실행 (하루 5회)')
    expect(hourlyPreviewText(hourly({ interval: 1 }))).toBe('09:00 · 10:00 · 11:00 · … · 18:00 에 실행 (하루 10회)')
    expect(hourlyPreviewText(hourly({ untilTime: '08:00' }))).toBeNull()
  })

  test('검사 — 요일 하나 이상, 끝 시각은 시작보다 뒤', () => {
    expect(validateTaskRecurrence(hourly())).toBeNull()
    expect(validateTaskRecurrence(hourly({ hourlyDays: [] }))).toBe('요일을 하나 이상 고르세요')
    expect(validateTaskRecurrence(hourly({ untilTime: '09:00' }))).toMatch(/끝 시각은 시작 시각보다 뒤/)
    expect(validateTaskRecurrence(hourly({ time: '22:00', untilTime: '02:00' }))).toMatch(/자정/)
    expect(validateTaskRecurrence(hourly({ untilTime: '' }))).toMatch(/끝 시각/)
    expect(validateTaskRecurrence(hourly({ interval: 5 }))).toBe('간격을 고르세요')
  })

  // WP-1413: 시간대와 간격 사이에 「 · 」를 둔다 — 「평일 09~18시 · 2시간마다」.
  test('요약 문구 — 「평일 09~18시 · 2시간마다」', () => {
    expect(recurrenceLabel('FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=18:00', '09:00')).toBe('평일 09~18시 · 2시간마다')
    expect(recurrenceLabel('FREQ=HOURLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA,SU;UNTILTIME=17:30', '09:30')).toBe('매일 09:30~17:30 · 1시간마다')
    expect(recurrenceLabel('FREQ=HOURLY;INTERVAL=3;BYDAY=MO,WE;UNTILTIME=18:00', '09:00')).toBe('월·수 09~18시 · 3시간마다')
    // 읽을 수 없으면 원문.
    expect(recurrenceLabel('FREQ=HOURLY;INTERVAL=2;BYDAY=MO', '09:00')).toBe('FREQ=HOURLY;INTERVAL=2;BYDAY=MO 09:00')
    expect(aiHandoffLabel({ rrule: 'FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=18:00', time: '09:00', agentName: '내 비서' })).toBe(
      '내 비서 · ↻ 평일 09~18시 · 2시간마다',
    )
    const mine = { name: '도우미', username: 'my-ai', personalAssistant: true }
    expect(createHandoffSummary(mine, hourly())).toBe('내 AI 비서 · ↻ 평일 09~18시 · 2시간마다')
  })

  test('다음 실행 미리보기 — 시간대 안 다음 회차, 마지막 뒤는 다음 실행 요일의 시작', () => {
    const at = (f: Parameters<typeof previewNextRun>[0], now: string) => {
      const d = previewNextRun(f, new Date(now))
      return d ? kstShortDateTime(d) : null
    }
    // 2026-11-03(화) 08:00 KST → 09:00, 10:30 KST → 11:00, 17:00 KST(마지막 회차 정각) → 수 09:00.
    expect(at(hourly(), '2026-11-02T23:00:00Z')).toBe('11/3(화) 09:00')
    expect(at(hourly(), '2026-11-03T01:30:00Z')).toBe('11/3(화) 11:00')
    expect(at(hourly(), '2026-11-03T08:00:00Z')).toBe('11/4(수) 09:00')
    // 금 17:00 KST 뒤는 월 09:00(주말 건너뜀).
    expect(at(hourly(), '2026-11-06T08:00:00Z')).toBe('11/9(월) 09:00')
    expect(previewNextRun(hourly({ hourlyDays: [] }), new Date('2026-11-03T00:00:00Z'))).toBeNull()
  })
})

// WP-1413: 「몇 시간마다」의 「시간대 정하기」 스위치(기본 꺼짐 = 하루 종일). 서버는 바꾸지 않는다 — 꺼짐은 run_time 00:00 + UNTILTIME=23:59 로 저장하고,
// 읽을 때 이 조합이면 꺼짐으로 그린다.
describe('몇 시간마다 시간대 정하기 (WP-1413)', () => {
  const allDay = (o: Partial<typeof DEFAULT_TASK_RECURRENCE_FORM> = {}) => form({ freq: 'HOURLY', hourlyWindow: false, ...o })

  test('꺼짐은 입력해 둔 시각과 상관없이 00:00 부터 23:59 까지로 저장한다 — 시각은 폼에 남아 다시 켜면 되살아난다', () => {
    const f = allDay({ time: '07:00', untilTime: '21:00' })
    expect(buildTaskRRule(f)).toBe('FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=23:59')
    expect(taskRunTime(f)).toBe('00:00')
    // 켜면 입력해 둔 07:00~21:00 이 그대로다.
    const on = { ...f, hourlyWindow: true }
    expect(buildTaskRRule(on)).toBe('FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=21:00')
    expect(taskRunTime(on)).toBe('07:00')
    // 다른 빈도는 늘 입력한 시각.
    expect(taskRunTime(form({ freq: 'DAILY', time: '08:30', hourlyWindow: false }))).toBe('08:30')
  })

  test('00:00 + UNTILTIME=23:59 는 꺼짐으로 읽고 시각 칸에는 기본 09:00~18:00 을 둔다 — 그대로 저장하면 같은 규칙', () => {
    const rrule = 'FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=23:59'
    const f = parseTaskRRule(rrule, '00:00')
    expect(f).toMatchObject({ freq: 'HOURLY', hourlyWindow: false, interval: 2, time: '09:00', untilTime: '18:00' })
    expect(buildTaskRRule(f)).toBe(rrule)
    expect(taskRunTime(f)).toBe('00:00')
  })

  test('시간대가 있는 기존 규칙은 켬 + 그 시각으로 읽고, 그대로 저장하면 같은 규칙', () => {
    const rrule = 'FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=21:00'
    const f = parseTaskRRule(rrule, '07:00')
    expect(f).toMatchObject({ freq: 'HOURLY', hourlyWindow: true, time: '07:00', untilTime: '21:00' })
    expect(buildTaskRRule(f)).toBe(rrule)
    expect(taskRunTime(f)).toBe('07:00')
    // 끝만 23:59 이고 시작이 00:00 이 아니면 시간대가 있는 것이다.
    expect(parseTaskRRule('FREQ=HOURLY;INTERVAL=2;BYDAY=MO;UNTILTIME=23:59', '06:00')).toMatchObject({ hourlyWindow: true, time: '06:00', untilTime: '23:59' })
  })

  test('하루 실행 시각은 00:00 부터 간격마다 — 2시간마다 12회, 12시간마다 2회, 1시간마다 24회', () => {
    expect(hourlyRunTimes(allDay())).toEqual(['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'])
    expect(hourlyRunTimes(allDay({ interval: 12 }))).toEqual(['00:00', '12:00'])
    expect(hourlyRunTimes(allDay({ interval: 1 }))).toHaveLength(24)
  })

  test('미리보기 — 꺼짐은 「하루 종일 — 」만 앞에 두고 목록·줄임은 켬과 같다(앞 3개 · … · 마지막)', () => {
    expect(hourlyPreviewText(allDay())).toBe('하루 종일 — 00:00 · 02:00 · 04:00 · … · 22:00 에 실행 (하루 12회)')
    expect(hourlyPreviewText(allDay({ interval: 12 }))).toBe('하루 종일 — 00:00 · 12:00 에 실행 (하루 2회)')
    expect(hourlyPreviewText(allDay({ interval: 4 }))).toBe('하루 종일 — 00:00 · 04:00 · 08:00 · 12:00 · 16:00 · 20:00 에 실행 (하루 6회)')
    expect(hourlyPreviewText(allDay({ interval: 1 }))).toBe('하루 종일 — 00:00 · 01:00 · 02:00 · … · 23:00 에 실행 (하루 24회)')
  })

  test('검사 — 꺼짐은 시각을 보지 않고(숨은 칸이 저장을 막지 않게), 켬은 지금처럼 시작 < 끝', () => {
    expect(validateTaskRecurrence(allDay({ time: '', untilTime: '' }))).toBeNull()
    expect(validateTaskRecurrence(allDay({ time: '22:00', untilTime: '02:00' }))).toBeNull()
    expect(validateTaskRecurrence(allDay({ hourlyDays: [] }))).toBe('요일을 하나 이상 고르세요')
    expect(validateTaskRecurrence(allDay({ hourlyWindow: true, time: '22:00', untilTime: '02:00' }))).toMatch(/자정/)
    expect(validateTaskRecurrence(allDay({ hourlyWindow: true, time: '' }))).toBe('시각을 HH:mm 으로 입력하세요')
  })

  test('다음 실행 미리보기 — 꺼짐은 하루 종일 회차 중 다음 것', () => {
    // 2026-11-03(화) 08:00 KST → 10:00, 금 23:00 KST → 월 00:00.
    expect(kstShortDateTime(previewNextRun(allDay(), new Date('2026-11-02T23:00:00Z'))!)).toBe('11/3(화) 10:00')
    expect(kstShortDateTime(previewNextRun(allDay(), new Date('2026-11-06T14:00:00Z'))!)).toBe('11/9(월) 00:00')
  })

  test('요약 — 시간대가 없으면 「평일 · 2시간마다」, 매일이면 「매일 · 2시간마다」', () => {
    expect(recurrenceLabel('FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=23:59', '00:00')).toBe('평일 · 2시간마다')
    expect(recurrenceLabel('FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR,SA,SU;UNTILTIME=23:59', '00:00')).toBe('매일 · 2시간마다')
    const mine = { name: '도우미', username: 'my-ai', personalAssistant: true }
    expect(createHandoffSummary(mine, allDay({ time: '07:00', untilTime: '21:00' }))).toBe('내 AI 비서 · ↻ 평일 · 2시간마다')
  })
})

// WP-1413: 데스크톱 이슈 속성 「AI 에게 맡기기」 요약은 AI 이름·일정 두 줄 — 부분을 나눠 준다.
describe('aiHandoffParts (WP-1413)', () => {
  test('AI 이름·일정·되풀이 여부로 나눈다 — 한 번만은 되풀이가 아니다, 일정이 없으면 null', () => {
    expect(aiHandoffParts({ rrule: 'FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTILTIME=21:00', time: '07:00', agentName: 'AI 이슈 관리자' })).toEqual({
      agent: 'AI 이슈 관리자',
      schedule: '평일 07~21시 · 2시간마다',
      repeating: true,
    })
    expect(aiHandoffParts({ rrule: 'FREQ=DAILY', time: '08:30', agentName: '내 비서' })).toEqual({ agent: '내 비서', schedule: '매일 08:30', repeating: true })
    expect(aiHandoffParts({ rrule: 'FREQ=ONCE;DATE=2026-11-03', time: '08:30', agentName: '내 비서' })).toEqual({
      agent: '내 비서',
      schedule: '한 번만 11/3(화) 08:30',
      repeating: false,
    })
    expect(aiHandoffParts(null)).toBeNull()
  })
})
