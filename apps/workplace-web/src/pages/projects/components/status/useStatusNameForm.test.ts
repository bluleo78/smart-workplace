import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import { STATUS_LIMIT, STATUS_LIMIT_TOOLTIP, STATUS_NAME_DUPLICATED } from '@/lib/projectStatuses'
import type { ProjectStatus } from '@/types/projectStatus'

import { checkStatusName, statusNameSaveError } from './useStatusNameForm'

/** 응답이 있는 axios 오류 — 서버 거절을 흉내 낸다. */
function httpError(status: number, message: string): AxiosError {
  const headers = new AxiosHeaders()
  return new AxiosError('fail', 'ERR', { headers }, null, { status, statusText: '', headers, config: { headers }, data: { status, message } })
}

function statusList(n: number): ProjectStatus[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `상태 ${i + 1}`, category: 'TODO', position: i, color: 'GRAY' }))
}

// 설정 추가 입력 줄·보드 이름 입력기가 같이 쓰는 서버 오류 문구(WP-937).
describe('statusNameSaveError', () => {
  it('중복 409 는 클라이언트 중복 문구로 — 「: 이름」을 되풀이하지 않는다', () => {
    expect(statusNameSaveError(httpError(409, `${STATUS_NAME_DUPLICATED}: 검토 중`), '실패')).toBe(STATUS_NAME_DUPLICATED)
  })

  it('상한 409 는 중복이 아니므로 서버 문구 그대로', () => {
    expect(statusNameSaveError(httpError(409, '상태는 프로젝트당 20개까지 만들 수 있어요'), '실패')).toBe('상태는 프로젝트당 20개까지 만들 수 있어요')
  })

  it('400 검증 문구는 그대로, 응답 없는 오류는 대체 문구', () => {
    expect(statusNameSaveError(httpError(400, '상태 이름을 입력해 주세요'), '실패')).toBe('상태 이름을 입력해 주세요')
    expect(statusNameSaveError(new Error('x'), '실패')).toBe('실패')
  })
})

describe('checkStatusName', () => {
  it('이름 변경은 자기 자신과의 중복으로 보지 않는다', () => {
    expect(checkStatusName(' 상태 1 ', { statuses: statusList(3), excludeId: 1 })).toBeNull()
  })

  it('빈 이름·중복은 검증 문구', () => {
    expect(checkStatusName('  ', { statuses: statusList(3) })).toBe('상태 이름을 입력해 주세요')
    expect(checkStatusName('상태 2', { statuses: statusList(3) })).toBe(STATUS_NAME_DUPLICATED)
  })

  it('새 상태는 상한에 닿으면 진입점과 같은 문구로 막고, 이름 변경은 상한과 무관하다', () => {
    const full = statusList(STATUS_LIMIT)
    expect(checkStatusName('새 상태', { statuses: full })).toBe(STATUS_LIMIT_TOOLTIP)
    expect(checkStatusName('새 이름', { statuses: full, excludeId: 1 })).toBeNull()
    expect(checkStatusName('새 상태', { statuses: statusList(STATUS_LIMIT - 1) })).toBeNull()
  })
})
