// 「별표」(WP-1698) 순수 판정 — 둘째 줄 문구, 폴더·파일 위치 주소, 보기 창 입력.
import { describe, expect, it } from 'vitest'

import type { DriveStarredItem } from '@/types/drive'

import { isStarredMissing, starredLocationPath, starredMetaLine, starredViewerFile } from './driveStarred'

const file = (over: Partial<DriveStarredItem> = {}): DriveStarredItem => ({
  kind: 'FILE',
  id: 70,
  name: '사업계획.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  fileId: 900,
  category: 'DOCUMENT',
  versionCount: 1,
  available: true,
  folderCount: null,
  fileCount: null,
  parentFolderId: 12,
  path: '보고/1분기',
  spaceId: 3,
  spaceName: '경영지원',
  updatedAt: '2026-11-12T03:00:00Z',
  starredAt: '2026-11-13T03:00:00Z',
  ...over,
})

const folder = (over: Partial<DriveStarredItem> = {}): DriveStarredItem =>
  file({ kind: 'FOLDER', id: 12, name: '1분기', mimeType: null, sizeBytes: null, fileId: null, category: null, versionCount: null, available: null, folderCount: 2, fileCount: 5, parentFolderId: 4, path: '보고', ...over })

describe('starredMetaLine', () => {
  it('파일은 경로 · 크기', () => {
    expect(starredMetaLine(file())).toBe('보고/1분기 · 2.0 KB')
  })
  it('최상위 파일은 크기만', () => {
    expect(starredMetaLine(file({ path: '', parentFolderId: null }))).toBe('2.0 KB')
  })
  it('폴더는 경로 · 폴더 n개 · 파일 n개(수가 없으면 0)', () => {
    expect(starredMetaLine(folder())).toBe('보고 · 폴더 2개 · 파일 5개')
    expect(starredMetaLine(folder({ path: '', folderCount: null, fileCount: null }))).toBe('폴더 0개 · 파일 0개')
  })
})

describe('위치 주소', () => {
  it('파일 위치 열기는 그 폴더에서 보기 창까지', () => {
    expect(starredLocationPath(file())).toBe('/drive/spaces/3?folderId=12&preview=70')
    expect(starredLocationPath(file({ parentFolderId: null }))).toBe('/drive/spaces/3?preview=70')
  })
  it('폴더 위치 열기는 상위 폴더(최상위면 공간 루트)', () => {
    expect(starredLocationPath(folder())).toBe('/drive/spaces/3?folderId=4')
    expect(starredLocationPath(folder({ parentFolderId: null }))).toBe('/drive/spaces/3')
  })
})

describe('starredViewerFile', () => {
  it('파일 행은 보기 창 입력으로 바꾼다', () => {
    expect(starredViewerFile(file())).toMatchObject({ id: 70, folderId: 12, fileId: 900, name: '사업계획.pdf', mimeType: 'application/pdf', sizeBytes: 2048 })
  })
  it('폴더 행은 null', () => {
    expect(starredViewerFile(folder())).toBeNull()
  })
  it('원본 유무·버전 수는 서버 값을 옮기고, 값이 없는 옛 응답이면 원본 있음·버전 1', () => {
    expect(starredViewerFile(file({ available: false, versionCount: 4 }))).toMatchObject({ available: false, versionCount: 4 })
    expect(starredViewerFile(file({ available: null, versionCount: null }))).toMatchObject({ available: true, versionCount: 1 })
  })
})

describe('isStarredMissing', () => {
  it('available=false 인 파일만 원본 유실', () => {
    expect(isStarredMissing(file({ available: false }))).toBe(true)
    expect(isStarredMissing(file({ available: true }))).toBe(false)
    expect(isStarredMissing(file({ available: null }))).toBe(false)
    expect(isStarredMissing(folder())).toBe(false)
  })
})
