// 공유 링크 만료일 기본값 — 폴더 + 외부일 때만 오늘+30일을 미리 채운다(WP-1538 P4).
import { describe, expect, it } from 'vitest'

import { defaultFolderExpiry, initialExpiry, nextExpiry, shareFormGuide } from './shareLinkDefaults'

const today = new Date(2026, 10, 13)

describe('shareLinkDefaults', () => {
  it('folder external default is today+30 local', () => {
    expect(defaultFolderExpiry(today)).toBe('2026-12-13')
  })
  it('switch to internal clears untouched default', () => {
    expect(nextExpiry({ kind: 'folder', audience: 'INTERNAL', touched: false, current: '2026-12-13', today })).toBe('')
  })
  it('back to external refills untouched', () => {
    expect(nextExpiry({ kind: 'folder', audience: 'EXTERNAL', touched: false, current: '', today })).toBe('2026-12-13')
  })
  it('touched value is kept on switch', () => {
    expect(nextExpiry({ kind: 'folder', audience: 'INTERNAL', touched: true, current: '2027-01-01', today })).toBe('2027-01-01')
    expect(nextExpiry({ kind: 'folder', audience: 'EXTERNAL', touched: true, current: '', today })).toBe('')
  })
  it('file never gets a default', () => {
    expect(nextExpiry({ kind: 'file', audience: 'EXTERNAL', touched: false, current: '', today })).toBe('')
  })
  it('initial expiry follows kind (folder +30, file empty)', () => {
    expect(initialExpiry('folder', today)).toBe('2026-12-13')
    expect(initialExpiry('file', today)).toBe('')
  })
  it('month/year rollover keeps local date', () => {
    expect(defaultFolderExpiry(new Date(2026, 11, 15, 23, 30))).toBe('2027-01-14')
  })
  it('form guide: file has none, folder external warns + hint, internal notice only', () => {
    expect(shareFormGuide('file', 'EXTERNAL')).toEqual({ warning: null, notice: null, expiryHint: null })
    const ext = shareFormGuide('folder', 'EXTERNAL')
    expect(ext.warning).toContain('링크를 가진 누구나')
    expect(ext.notice).toBeNull()
    expect(ext.expiryHint).toBe('외부 폴더 링크는 30일 뒤로 미리 채웁니다.')
    const int = shareFormGuide('folder', 'INTERNAL')
    expect(int.warning).toBeNull()
    expect(int.notice).toContain('같은 워크스페이스 직원')
    expect(int.expiryHint).toBeNull()
  })
})
