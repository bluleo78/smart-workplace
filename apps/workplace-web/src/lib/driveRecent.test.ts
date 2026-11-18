// 「최근」(WP-1699) 순수 함수 — 날짜 묶음·마지막 활동 문구·경로 줄. now 는 KST 2026-11-18(수) 10:00 로 고정한다.
import { describe, expect, test } from 'vitest'

import type { DriveRecentFile } from '@/types/drive'

import { groupRecent, recentActivityLabel, recentBucket, recentPathLine } from './driveRecent'

const NOW = new Date('2026-11-18T01:00:00Z')

function file(id: number, lastAt: string): DriveRecentFile {
  return {
    driveFileId: id, name: `f${id}`, mimeType: 'text/plain', sizeBytes: 1, spaceId: 1, spaceName: '기획팀',
    folderId: null, folderPath: [], lastAction: 'OPEN', lastAt,
  }
}

describe('recentBucket', () => {
  test.each([
    ['2026-11-18T00:00:00Z', 'today'], // 09:00 KST
    ['2026-11-17T14:59:00Z', 'yesterday'], // 11-17 23:59 KST
    ['2026-11-15T15:00:00Z', 'thisWeek'], // 11-16(월) 00:00 KST
    ['2026-11-15T14:59:00Z', 'thisMonth'], // 11-15(일) 23:59 KST
    ['2026-10-31T03:00:00Z', 'earlier'],
    ['2026-11-17T15:30:00Z', 'today'], // 11-18 00:30 KST
  ])('%s → %s', (at, expected) => {
    expect(recentBucket(at, NOW)).toBe(expected)
  })

  test('월요일이면 어제(일요일)는 어제 묶음, 그 앞 일요일 이전은 이번 달', () => {
    const monday = new Date('2026-11-16T01:00:00Z')
    expect(recentBucket('2026-11-15T03:00:00Z', monday)).toBe('yesterday')
    expect(recentBucket('2026-11-14T03:00:00Z', monday)).toBe('thisMonth')
  })
})

describe('recentActivityLabel', () => {
  test('30초 전 OPEN → 방금', () => {
    expect(recentActivityLabel({ lastAction: 'OPEN', lastAt: '2026-11-18T00:59:30Z' }, NOW)).toBe('방금 내가 열었음')
  })
  test('10분 전 OPEN', () => {
    expect(recentActivityLabel({ lastAction: 'OPEN', lastAt: '2026-11-18T00:50:00Z' }, NOW)).toBe('10분 전 내가 열었음')
  })
  test('1시간 전 UPLOAD', () => {
    expect(recentActivityLabel({ lastAction: 'UPLOAD', lastAt: '2026-11-18T00:00:00Z' }, NOW)).toBe('1시간 전 내가 올림')
  })
  test('어제 11:05 KST NEW_VERSION', () => {
    expect(recentActivityLabel({ lastAction: 'NEW_VERSION', lastAt: '2026-11-17T02:05:00Z' }, NOW)).toBe('어제 11:05 내가 새 판')
  })
  test('11월 16일 OPEN → 날짜만', () => {
    expect(recentActivityLabel({ lastAction: 'OPEN', lastAt: '2026-11-16T03:00:00.123456Z' }, NOW)).toBe('11월 16일 내가 열었음')
  })
  test('다른 해는 연도까지', () => {
    expect(recentActivityLabel({ lastAction: 'OPEN', lastAt: '2025-11-16T03:00:00Z' }, NOW)).toBe('2025년 11월 16일 내가 열었음')
  })
})

describe('groupRecent', () => {
  test('섞인 입력도 순서를 유지하고 빈 묶음은 만들지 않는다', () => {
    const items = [file(1, '2026-11-18T00:30:00Z'), file(2, '2026-11-17T03:00:00Z'), file(3, '2026-11-18T00:10:00Z'), file(4, '2026-10-01T00:00:00Z')]
    const groups = groupRecent(items, NOW)
    expect(groups.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'earlier'])
    expect(groups[0].items.map((i) => i.driveFileId)).toEqual([1, 3])
  })
  test('빈 입력은 빈 배열', () => {
    expect(groupRecent([], NOW)).toEqual([])
  })
})

describe('recentPathLine', () => {
  test('공간 › 폴더 › 하위폴더 · 크기', () => {
    const f = { ...file(1, '2026-11-18T00:00:00Z'), folderPath: [{ id: 1, name: '위' }, { id: 2, name: '아래' }], sizeBytes: 1_258_291 }
    expect(recentPathLine(f)).toBe('기획팀 › 위 › 아래 · 1.2 MB')
  })
  test('루트 파일은 공간만', () => {
    expect(recentPathLine(file(1, '2026-11-18T00:00:00Z'))).toBe('기획팀 · 1 B')
  })
})
