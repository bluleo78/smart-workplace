// 「공유받은 항목」(WP-1539) 순수 판정 — 마지막으로 연 날 표기, 열 수 있는 행 판정.
import { describe, expect, it } from 'vitest'

import type { SharedWithMeItem } from '@/types/drive'

import { canOpenShared, resolveSharedTarget, sharedClosedReason, sharedFolderPath, sharedMetaLine, sharedOpenedLabel } from './driveSharedWithMe'

const item = (over: Partial<SharedWithMeItem> = {}): SharedWithMeItem => ({
  shareLinkId: 1,
  kind: 'FILE',
  name: 'a.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 10,
  folderCount: null,
  fileCount: null,
  spaceName: '영업 자료',
  sharedBy: '양동희',
  lastOpenedAt: '2026-11-12T03:00:00Z',
  openable: true,
  hasPassword: false,
  token: 'sl_a',
  ...over,
})

describe('sharedOpenedLabel', () => {
  const now = new Date('2026-11-13T05:00:00Z') // KST 11월 13일 14시
  it('오늘·어제는 말로, 그 밖은 월·일, 다른 해는 연도를 붙인다', () => {
    expect(sharedOpenedLabel('2026-11-13T01:00:00Z', now)).toBe('오늘')
    expect(sharedOpenedLabel('2026-11-12T01:00:00Z', now)).toBe('어제')
    expect(sharedOpenedLabel('2026-10-28T03:00:00Z', now)).toBe('10월 28일')
    expect(sharedOpenedLabel('2025-10-28T03:00:00Z', now)).toBe('2025년 10월 28일')
  })

  it('자정 무렵에도 날짜를 KST 하나로 본다 — 「어제」 다음 칸이 하루 어긋나지 않는다', () => {
    // 지금 KST 11월 13일 00:30(UTC 11월 12일 15:30)
    const midnight = new Date('2026-11-12T15:30:00Z')
    // KST 11월 12일 23:50 → 어제
    expect(sharedOpenedLabel('2026-11-12T14:50:00Z', midnight)).toBe('어제')
    // KST 11월 11일 00:10(UTC 11월 10일 15:10) → 11월 11일(UTC 날짜 10일이 아니라)
    expect(sharedOpenedLabel('2026-11-10T15:10:00Z', midnight)).toBe('11월 11일')
    // KST 2026년 1월 1일 00:10(UTC 2025-12-31) → 올해 날짜로
    expect(sharedOpenedLabel('2025-12-31T15:10:00Z', midnight)).toBe('1월 1일')
  })
})

describe('sharedClosedReason', () => {
  it('서버가 열 수 없다고 하면 폐기·만료 문구, 링크는 살아 있는데 토큰이 없으면 중립 문구', () => {
    expect(sharedClosedReason(item())).toBeNull()
    expect(sharedClosedReason(item({ openable: false, token: null }))).toBe('링크가 폐기됐거나 만료됐습니다')
    expect(sharedClosedReason(item({ token: null }))).toBe('링크를 열 수 없습니다')
  })
})

describe('canOpenShared', () => {
  it('서버가 열 수 있다고 하고 토큰이 있어야 연다', () => {
    expect(canOpenShared(item())).toBe(true)
    expect(canOpenShared(item({ openable: false, token: null }))).toBe(false)
    // 되살릴 수 없는 옛 링크 — 살아 있어도 열기·복사를 막는다
    expect(canOpenShared(item({ token: null }))).toBe(false)
  })
})

describe('resolveSharedTarget', () => {
  it('열 수 없으면 이유와 함께 closed — 폐기·만료와 토큰 없음의 문구가 다르다', () => {
    expect(resolveSharedTarget(item({ openable: false, token: null }))).toEqual({ kind: 'closed', reason: '링크가 폐기됐거나 만료됐습니다' })
    expect(resolveSharedTarget(item({ token: null }))).toEqual({ kind: 'closed', reason: '링크를 열 수 없습니다' })
  })

  it('비밀번호 링크는 종류와 상관없이 공유 화면으로(password)', () => {
    expect(resolveSharedTarget(item({ hasPassword: true }))).toEqual({ kind: 'password', token: 'sl_a' })
    expect(resolveSharedTarget(item({ kind: 'FOLDER', hasPassword: true }))).toEqual({ kind: 'password', token: 'sl_a' })
  })

  it('폴더는 드라이브 안 폴더 화면 주소, 파일은 토큰', () => {
    expect(resolveSharedTarget(item({ kind: 'FOLDER', shareLinkId: 11 }))).toEqual({ kind: 'folder', token: 'sl_a', path: '/drive/shared/11' })
    expect(resolveSharedTarget(item())).toEqual({ kind: 'file', token: 'sl_a' })
  })
})

describe('sharedMetaLine', () => {
  const file = item({ spaceName: '경영지원', sizeBytes: 4_404_019 })
  const folder = item({ kind: 'FOLDER', name: '분기 보고', mimeType: null, sizeBytes: null, spaceName: '경영지원' })
  it('파일은 공간 · 크기', () => expect(sharedMetaLine(file)).toBe('경영지원 · 4.2 MB'))
  it('폴더는 공간 · 폴더 n개 · 파일 n개', () =>
    expect(sharedMetaLine({ ...folder, folderCount: 3, fileCount: 12 })).toBe('경영지원 · 폴더 3개 · 파일 12개'))
  it('열 수 없으면 이유 문구', () =>
    expect(sharedMetaLine({ ...folder, openable: false, token: null })).toBe('링크가 폐기됐거나 만료됐습니다'))
  it('폴더 수가 null 이면 0개', () =>
    expect(sharedMetaLine({ ...folder, folderCount: null, fileCount: null })).toBe('경영지원 · 폴더 0개 · 파일 0개'))
})

describe('sharedFolderPath', () => {
  it('공유 폴더', () => expect(sharedFolderPath(11, null)).toBe('/drive/shared/11'))
  it('하위 폴더', () => expect(sharedFolderPath(11, 42)).toBe('/drive/shared/11?folder=42'))
})
