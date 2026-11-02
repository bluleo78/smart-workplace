// AI 실행(WP-1245) 화면 판정 순수 함수 — 실행 방식 구분·상태 알약·자원 표기·위치 라벨.
import { describe, expect, test } from 'vitest'

import { CLAUDE_TEMPLATE, createLocation, DEFAULT_TEMPLATE } from '../test/kits/admin/agentRuntime'
import {
  configWithDefaults,
  connectionPill,
  formatCpu,
  formatMemory,
  formatUptime,
  freeSeats,
  isRunningStatus,
  locationDeleteBlockReason,
  locationOptionLabel,
  metricsUnavailable,
  parseMemoryQuantity,
  statusDetail,
  statusPill,
} from './agentRuntimeStatus'

describe('statusPill — 상태 알약', () => {
  test.each([
    ['OFF', null, '꺼짐', 'inactive'],
    ['STARTING', null, '시작하는 중', 'info'],
    ['STOPPING', null, '멈추는 중', 'inactive'],
    ['FAILED', null, '실패', 'error'],
  ] as const)('%s 는 AI 보고와 무관하게 %s', (status, state, label, type) => {
    expect(statusPill(status, state)).toEqual({ label, type })
    // 켜짐 계열이 아니면 AI 가 보고한 일 상태가 있어도 무시한다.
    expect(statusPill(status, 'WORKING')).toEqual({ label, type })
  })
  test.each(['RUNNING', 'APPLY_PENDING'] as const)('%s 는 AI 가 보고한 일 상태로 나뉜다', (status) => {
    expect(statusPill(status, 'WORKING')).toEqual({ label: '작업 중', type: 'active' })
    expect(statusPill(status, 'IDLE')).toEqual({ label: '쉬는 중', type: 'active' })
    expect(statusPill(status, 'BLOCKED')).toEqual({ label: '막힘', type: 'warning' })
  })
  test('실행 중인데 아직 보고가 없으면 시작하는 중', () => {
    expect(statusPill('RUNNING', null)).toEqual({ label: '시작하는 중', type: 'info' })
    expect(statusPill('RUNNING', undefined)).toEqual({ label: '시작하는 중', type: 'info' })
  })
})

test('isRunningStatus — 켜는 중·켜짐·적용 대기만 켜진 상태', () => {
  expect(['STARTING', 'RUNNING', 'APPLY_PENDING'].every((s) => isRunningStatus(s as never))).toBe(true)
  expect(['OFF', 'STOPPING', 'FAILED'].some((s) => isRunningStatus(s as never))).toBe(false)
})

describe('statusDetail — 상태 옆 한 줄', () => {
  const base = { status: 'RUNNING', agentState: null, agentIssueKey: null, agentNextCheckAt: null, message: null } as const
  test('실패면 사유(없으면 null)', () => {
    expect(statusDetail({ ...base, status: 'FAILED', message: 'ImagePullBackOff' })).toEqual({ kind: 'error', text: 'ImagePullBackOff' })
    expect(statusDetail({ ...base, status: 'FAILED', message: '' })).toBeNull()
    expect(statusDetail({ ...base, status: 'FAILED', message: null })).toBeNull()
  })
  test('꺼짐·끄는 중·켜는 중에는 보일 것이 없다', () => {
    for (const status of ['OFF', 'STOPPING', 'STARTING'] as const) {
      expect(statusDetail({ ...base, status, agentState: 'WORKING', agentIssueKey: 'WD-1' })).toBeNull()
    }
  })
  test('작업 중·막힘이면 이슈 키, 키가 없으면 null', () => {
    expect(statusDetail({ ...base, agentState: 'WORKING', agentIssueKey: 'WD-319' })).toEqual({ kind: 'issue', text: 'WD-319' })
    expect(statusDetail({ ...base, status: 'APPLY_PENDING', agentState: 'BLOCKED', agentIssueKey: 'WP-1203' })).toEqual({ kind: 'issue', text: 'WP-1203' })
    expect(statusDetail({ ...base, agentState: 'WORKING' })).toBeNull()
  })
  test('대기면 「다음 확인 HH:mm」(KST), 시각이 없으면 null', () => {
    expect(statusDetail({ ...base, agentState: 'IDLE', agentNextCheckAt: '2026-11-02T03:30:00Z' })).toEqual({ kind: 'nextCheck', text: '다음 확인 12:30' })
    expect(statusDetail({ ...base, agentState: 'IDLE' })).toBeNull()
  })
  test('보고가 없으면 null', () => {
    expect(statusDetail(base)).toBeNull()
  })
})

describe('자원 표기', () => {
  test('formatCpu — 밀리코어를 코어로, 모르면 -', () => {
    expect(formatCpu(4200)).toBe('4.2 코어')
    expect(formatCpu(0)).toBe('0.0 코어')
    expect(formatCpu(null)).toBe('-')
    expect(formatCpu(undefined)).toBe('-')
  })
  test('parseMemoryQuantity — 이진·십진 단위와 접미사 없는 바이트', () => {
    expect(parseMemoryQuantity('8Gi')).toBe(8 * 1024 ** 3)
    expect(parseMemoryQuantity('512Mi')).toBe(512 * 1024 ** 2)
    expect(parseMemoryQuantity('1Ki')).toBe(1024)
    expect(parseMemoryQuantity('2Ti')).toBe(2 * 1024 ** 4)
    expect(parseMemoryQuantity('16G')).toBe(16e9)
    expect(parseMemoryQuantity('5M')).toBe(5e6)
    expect(parseMemoryQuantity('3K')).toBe(3e3)
    expect(parseMemoryQuantity('1T')).toBe(1e12)
    expect(parseMemoryQuantity('1.5Gi')).toBe(1.5 * 1024 ** 3)
    expect(parseMemoryQuantity('1048576')).toBe(1048576)
    expect(parseMemoryQuantity(' 8Gi ')).toBe(8 * 1024 ** 3)
  })
  test('parseMemoryQuantity — 해석 못 하면 null', () => {
    expect(parseMemoryQuantity('abc')).toBeNull()
    expect(parseMemoryQuantity('8GB')).toBeNull()
    expect(parseMemoryQuantity('')).toBeNull()
    expect(parseMemoryQuantity(null)).toBeNull()
    expect(parseMemoryQuantity(undefined)).toBeNull()
  })
  test('formatMemory — 상한을 알면 「사용 / 상한 GiB」, 모르면 사용량만, 값이 없으면 -', () => {
    expect(formatMemory(3 * 1024 ** 3, '16Gi')).toBe('3.0 / 16 GiB')
    expect(formatMemory(3 * 1024 ** 3, null)).toBe('3.0 GiB')
    expect(formatMemory(3 * 1024 ** 3, '이상한값')).toBe('3.0 GiB')
    expect(formatMemory(null, '16Gi')).toBe('-')
  })
})

describe('formatUptime — 켜진 시간', () => {
  const now = new Date('2026-11-02T12:00:00Z')
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  test('시작 시각이 없거나 무효이거나 미래면 -', () => {
    expect(formatUptime(null, now)).toBe('-')
    expect(formatUptime(undefined, now)).toBe('-')
    expect(formatUptime('not-a-date', now)).toBe('-')
    expect(formatUptime(ago(-5), now)).toBe('-')
  })
  test('1분 미만·분·시간·일 단위', () => {
    expect(formatUptime(ago(0.5), now)).toBe('1분 미만')
    expect(formatUptime(ago(8), now)).toBe('8분')
    expect(formatUptime(ago(72), now)).toBe('1시간 12분')
    expect(formatUptime(ago(120), now)).toBe('2시간')
    expect(formatUptime(ago(26 * 60), now)).toBe('1일 2시간')
    expect(formatUptime(ago(48 * 60), now)).toBe('2일')
  })
})

test('configWithDefaults — 저장값이 먼저, 없으면 기본값, 기본값도 없으면 칸을 비운다', () => {
  expect(configWithDefaults(CLAUDE_TEMPLATE, undefined)).toEqual({ model: 'opus', queue: 'AI 개발팀' })
  expect(configWithDefaults(CLAUDE_TEMPLATE, { model: 'sonnet' })).toEqual({ model: 'sonnet', queue: 'AI 개발팀' })
  // 저장된 빈 문자열도 값이다(기본값으로 되돌리지 않는다).
  expect(configWithDefaults(CLAUDE_TEMPLATE, { queue: '' })).toEqual({ model: 'opus', queue: '' })
  const noDefault = { ...CLAUDE_TEMPLATE, config: [{ ...CLAUDE_TEMPLATE.config[1], default: null }] }
  expect(configWithDefaults(noDefault, undefined)).toEqual({})
  expect(configWithDefaults(DEFAULT_TEMPLATE, { x: 'y' })).toEqual({})
})

test('connectionPill — 연결됨·끊김·설치 대기', () => {
  expect(connectionPill('CONNECTED')).toEqual({ label: '연결됨', type: 'active' })
  expect(connectionPill('DISCONNECTED')).toEqual({ label: '끊김', type: 'error' })
  expect(connectionPill('PENDING')).toEqual({ label: '설치 대기', type: 'pending' })
})

test('freeSeats — 남은 자리는 0 아래로 내려가지 않는다', () => {
  expect(freeSeats({ capacity: 4, used: 3 })).toBe(1)
  expect(freeSeats({ capacity: 2, used: 2 })).toBe(0)
  expect(freeSeats({ capacity: 2, used: 5 })).toBe(0)
})

test('locationOptionLabel — 기본이면 (기본) 표시, 더 띄울 수 있는 AI 수 포함', () => {
  expect(locationOptionLabel(createLocation())).toBe('운영 (기본) · 1명 더 띄울 수 있음')
  expect(locationOptionLabel(createLocation({ name: 'PoC', isDefault: false, capacity: 2, used: 0 }))).toBe('PoC · 2명 더 띄울 수 있음')
})

describe('locationDeleteBlockReason — 실행 환경을 지울 수 없는 이유', () => {
  test('기본 실행 환경은 쓰는 설정이 없어도 막는다', () => {
    expect(locationDeleteBlockReason({ isDefault: true, settingCount: 0 })).toBe('기본 실행 환경은 지울 수 없어요')
  })
  test('쓰는 실행 설정이 있으면 꺼져 있어도 막는다', () => {
    expect(locationDeleteBlockReason({ isDefault: false, settingCount: 1 })).toBe('이 실행 환경을 쓰는 AI 가 있어 지울 수 없어요')
  })
  test('기본이면서 쓰는 설정도 있으면 기본 사유가 먼저', () => {
    expect(locationDeleteBlockReason({ isDefault: true, settingCount: 2 })).toBe('기본 실행 환경은 지울 수 없어요')
  })
  test('기본도 아니고 쓰는 설정도 없으면 지울 수 있다(null)', () => {
    expect(locationDeleteBlockReason({ isDefault: false, settingCount: 0 })).toBeNull()
  })
})

test('metricsUnavailable — 잴 수 없다고 확인된(false) 실행 환경만, 모름(null)·환경 없음은 아니다 (WP-1280)', () => {
  expect(metricsUnavailable(createLocation({ metricsAvailable: false }))).toBe(true)
  expect(metricsUnavailable(createLocation({ metricsAvailable: true }))).toBe(false)
  expect(metricsUnavailable(createLocation({ metricsAvailable: null }))).toBe(false)
  expect(metricsUnavailable(null)).toBe(false)
  expect(metricsUnavailable(undefined)).toBe(false)
})
