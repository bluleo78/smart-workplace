import { describe, expect, it } from 'vitest'

import {
  deriveBodyState,
  deriveSyncStatus,
  effectiveReadOnly,
  isEditRole,
  isTerminalStatus,
  parseRoleMessage,
  type SyncStatus,
} from './collabStatus'

// 헤더 상태 칩 판정 — 시안 collab-states/mobile-ux 의 ①~④.
describe('deriveSyncStatus', () => {
  const base = { connected: true, disconnectedForMs: 0, unsynced: false, readOnly: false }
  it('live when connected', () => expect(deriveSyncStatus(base)).toBe('live'))
  it('live when connected even with in-flight edits', () =>
    expect(deriveSyncStatus({ ...base, unsynced: true })).toBe('live'))
  it('readonly wins over everything', () =>
    expect(deriveSyncStatus({ ...base, connected: false, unsynced: true, readOnly: true })).toBe('readonly'))
  it('reconnecting for short drops', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 2000 })).toBe('reconnecting'))
  it('reconnecting just below the 5s threshold', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 4999 })).toBe('reconnecting'))
  it('offline at exactly 5s', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 5000 })).toBe('offline'))
  it('offline after 5s without local edits', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 6000 })).toBe('offline'))
  it('unsent when disconnected with local edits', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 1000, unsynced: true })).toBe('unsent'))
  it('unsent stays unsent long after the drop', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 60_000, unsynced: true })).toBe('unsent'))
  it('forbidden is terminal and wins over readonly', () =>
    expect(deriveSyncStatus({ ...base, connected: false, unsynced: true, readOnly: true, terminal: 'forbidden' })).toBe(
      'forbidden',
    ))
  it('deleted is terminal and wins over readonly and unsent', () =>
    expect(deriveSyncStatus({ ...base, connected: false, unsynced: true, readOnly: true, terminal: 'deleted' })).toBe('deleted'))
  it('a lost login is terminal and wins over the first connection', () =>
    expect(
      deriveSyncStatus({ ...base, connected: false, unsynced: true, readOnly: true, everSynced: false, terminal: 'authLost' }),
    ).toBe('signed-out'))
  // WP-313 — 스키마 판 불일치(새 버전 배포)는 새로고침 말곤 풀리지 않는 종단이라 다른 모든 상태보다 먼저.
  it('a schema mismatch is terminal and shows the reload state', () =>
    expect(
      deriveSyncStatus({
        ...base,
        connected: false,
        unsynced: true,
        readOnly: true,
        everSynced: false,
        terminal: 'schemaStale',
      }),
    ).toBe('outdated'))
  it('terminal=null behaves as omitted', () =>
    expect(deriveSyncStatus({ ...base, terminal: null })).toBe('live'))
  // 처음 붙는 중(첫 동기화 전) — 중립 '연결 중'. 권한 로딩 중의 화면 readOnly 나 '재연결 중' 경고를 띄우지 않는다.
  it('connecting before the first sync, even while the UI role is still read-only', () =>
    expect(
      deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 1000, readOnly: true, everSynced: false }),
    ).toBe('connecting'))
  it('offline when the first sync has not happened for 5s', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 5000, everSynced: false })).toBe('offline'))
  it('forbidden wins over connecting', () =>
    expect(deriveSyncStatus({ ...base, connected: false, everSynced: false, terminal: 'forbidden' })).toBe('forbidden'))
  it('a drop after the first sync is reconnecting, not connecting', () =>
    expect(deriveSyncStatus({ ...base, connected: false, disconnectedForMs: 1000, everSynced: true })).toBe(
      'reconnecting',
    ))
})

describe('isEditRole', () => {
  it('OWNER and EDITOR can edit', () => {
    expect(isEditRole('OWNER')).toBe(true)
    expect(isEditRole('EDITOR')).toBe(true)
  })
  it('anything else is read-only (fail-closed)', () => {
    expect(isEditRole('VIEWER')).toBe(false)
    expect(isEditRole('editor')).toBe(false)
    expect(isEditRole('')).toBe(false)
  })
})

describe('parseRoleMessage', () => {
  it('reads the role from a collab:role message', () =>
    expect(parseRoleMessage('{"type":"collab:role","role":"VIEWER"}')).toBe('VIEWER'))
  it('ignores other stateless types', () => expect(parseRoleMessage('{"type":"other","role":"VIEWER"}')).toBeNull())
  it('ignores a missing or non-string role', () => {
    expect(parseRoleMessage('{"type":"collab:role"}')).toBeNull()
    expect(parseRoleMessage('{"type":"collab:role","role":3}')).toBeNull()
  })
  it('ignores non-JSON payloads', () => {
    expect(parseRoleMessage('not json')).toBeNull()
    expect(parseRoleMessage('null')).toBeNull()
  })
})

describe('effectiveReadOnly', () => {
  it('falls back to the prop before the server says anything', () => {
    expect(effectiveReadOnly({ propReadOnly: true, serverReadOnly: null })).toBe(true)
    expect(effectiveReadOnly({ propReadOnly: false, serverReadOnly: null })).toBe(false)
  })
  it('VIEWER demotion makes an editor read-only', () =>
    expect(effectiveReadOnly({ propReadOnly: false, serverReadOnly: true })).toBe(true))
  it('EDITOR promotion re-enables editing even when the prop said read-only', () =>
    expect(effectiveReadOnly({ propReadOnly: true, serverReadOnly: false })).toBe(false))
  it('a session that lost its login is never editable', () =>
    expect(effectiveReadOnly({ propReadOnly: false, serverReadOnly: false, terminal: 'authLost' })).toBe(true))
  it('a session rejected for its schema version is never editable', () =>
    expect(effectiveReadOnly({ propReadOnly: false, serverReadOnly: false, terminal: 'schemaStale' })).toBe(true))
  it('a forbidden document is never editable', () =>
    expect(effectiveReadOnly({ propReadOnly: false, serverReadOnly: false, terminal: 'forbidden' })).toBe(true))
  it('a deleted document is never editable', () =>
    expect(effectiveReadOnly({ propReadOnly: false, serverReadOnly: false, terminal: 'deleted' })).toBe(true))
})

// 본문 자리 — 첫 동기화 전 skeleton 이 영영 남지 않게, 연결을 못 한 채 오프라인이 되면 안내로 바꾼다.
describe('deriveBodyState', () => {
  it('shows the body once synced, even while offline later', () => {
    expect(deriveBodyState({ everSynced: true, status: 'live' })).toBe('ready')
    expect(deriveBodyState({ everSynced: true, status: 'offline' })).toBe('ready')
  })

  it('keeps the skeleton while the first connection is still in progress', () => {
    expect(deriveBodyState({ everSynced: false, status: 'connecting' })).toBe('loading')
  })

  it('explains instead of a skeleton once the first connection has gone offline', () => {
    expect(deriveBodyState({ everSynced: false, status: 'offline' })).toBe('unreachable')
  })

  it('leaves every terminal state to its own notice', () => {
    for (const status of ['forbidden', 'deleted', 'signed-out', 'outdated'] as const)
      expect(deriveBodyState({ everSynced: false, status })).toBe('ready')
  })
})

describe('isTerminalStatus', () => {
  it('is true only for states that never reconnect', () => {
    expect(['forbidden', 'deleted', 'signed-out', 'outdated'].every((s) => isTerminalStatus(s as SyncStatus))).toBe(true)
    expect(['connecting', 'live', 'reconnecting', 'offline', 'unsent', 'readonly'].some((s) => isTerminalStatus(s as SyncStatus))).toBe(false)
  })
})
