// 작은 그래프 카드 단계 노출(WP-2079) — 데이터 도착 직후 카드 5장을 한 번에 그리면 메인 스레드가 막히므로,
// 타이머 체인으로 한 장씩 늘어나는지, 끝까지 진행하면 정의 전부가 다시 나오는지, 이미 그린 카드는 다시 렌더되지 않는지(Memo) 를 본다.
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { AiStatusOverview } from '@/api/aiStatus'

import { smallGraphs } from './aiStatusModel'
import { AiStatusSmallGraphs } from './AiStatusSmallGraphs'

// 카드 내부 렌더 카운터 — ChartCard 는 SmallGraphCard 안에서만 그려지므로, 제목(정의마다 하나)으로 세면
// 이미 나온 카드가 다음 단계에서 다시 렌더되는지 알 수 있다(원래 동작은 그대로 두고 호출 횟수만 센다).
const renders = vi.hoisted(() => new Map<string, number>())
vi.mock('@/components/metrics/ChartCard', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/metrics/ChartCard')>()
  return {
    ...orig,
    ChartCard: (props: Parameters<typeof orig.ChartCard>[0]) => {
      renders.set(props.title, (renders.get(props.title) ?? 0) + 1)
      return <orig.ChartCard {...props} />
    },
  }
})

/** 기간 안에 기록이 하나도 없는 응답 — 정의 5장은 그대로 나오고 차트는 빈 상태가 되어(청크 로드 없이) 판정이 결정적이다. */
const SERIES: AiStatusOverview['series'] = {
  buckets: ['2026-11-22T22:00:00Z', '2026-11-22T22:15:00Z'],
  responseP50: [null, null],
  responseP95: [null, null],
  failures: [null, null],
  queueWaiting: [null, null],
  slotUsed: [null, null],
  slotLimit: [null, null],
  backlog: {},
}

/** 모델이 만드는 정의 — 단언 기대값을 하드코딩하지 않고 실제 정의에서 뽑는다. */
const defs = smallGraphs(SERIES)
const testIds = defs.map((def) => def.testId)

/** 지금 그려진 카드 수. */
function drawnCount(): number {
  return testIds.filter((id) => screen.queryByTestId(id)).length
}

/** 타이머를 한 단계 진행 — 체인의 다음 타이머는 act 가 플러시한 뒤에 걸리므로 한 번에 한 장씩 늘어난다. */
function stepOnce(): void {
  act(() => {
    vi.runAllTimers()
  })
}

/** 타이머를 끝까지 진행 — 정의 수만큼 한 단계씩 밀어 걸 타이머가 없을 때까지 반복한다. */
function runTimersToEnd(): void {
  for (let i = 0; i < defs.length; i++) stepOnce()
}

beforeEach(() => {
  // 체인 타이머(setTimeout)만 가린다 — 다른 API 는 진짜를 써서 환경을 적게 바꾼다
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  renders.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderGraphs() {
  return render(<AiStatusSmallGraphs series={SERIES} bucketSeconds={900} />)
}

test('타이머를 끝까지 진행하면 정의한 카드가 전부 그려진다', () => {
  renderGraphs()
  runTimersToEnd()
  expect(drawnCount()).toBe(defs.length)
  for (const def of defs) {
    expect(screen.getByTestId(def.testId)).toBeInTheDocument()
  }
})

test('처음에는 정의보다 적은 카드만 보이고 타이머를 진행하며 늘어난다', () => {
  renderGraphs()
  // 첫 단계 — 아직 정의 전부가 아니다(전부 한 번에 그려지면 여기서 걸린다)
  stepOnce()
  const partial = drawnCount()
  expect(partial).toBeGreaterThan(0)
  expect(partial).toBeLessThan(defs.length)
  // 끝까지 진행하면 전부 나온다
  runTimersToEnd()
  expect(drawnCount()).toBe(defs.length)
})

test('이미 그린 카드는 단계가 늘어도 다시 렌더되지 않는다', () => {
  renderGraphs()
  stepOnce()
  const first = defs[0]
  expect(screen.getByTestId(first.testId)).toBeInTheDocument()
  const drawn = renders.get(first.title) as number
  expect(drawn).toBeGreaterThan(0)
  // 남은 단계를 진행 — 새 카드는 늘어나도 이미 그린 카드는 다시 안 그려진다
  runTimersToEnd()
  expect(drawnCount()).toBe(defs.length)
  expect(renders.get(first.title)).toBe(drawn)
  // 카운터는 새 카드가 그려질 때 늘어나는 것도 함께 본다 — 카운터 자체가 동작하는지의 검증
  expect(renders.get(defs[defs.length - 1].title)).toBe(1)
})

test('정의가 바뀌면 진행 중이던 단계 없이 새 정의를 전부 그린다(중간에 빈 카드가 남지 않는다)', () => {
  const { rerender } = renderGraphs()
  stepOnce()
  expect(drawnCount()).toBeLessThan(defs.length)
  // 기간 토글로 새 응답이 오면 defs 참조가 바뀐다 — 체인은 새 길이만큼 바로 채워야 한다(타이머를 돌리지 않아도)
  const next: AiStatusOverview['series'] = { ...SERIES, buckets: ['2026-11-23T00:00:00Z'] }
  rerender(<AiStatusSmallGraphs series={next} bucketSeconds={900} />)
  expect(drawnCount()).toBe(smallGraphs(next).length)
})
