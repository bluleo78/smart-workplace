// resolveInitialSaveLocation(WP-1526) — 기억한 저장 위치를 처음 공간·경로로 푸는 규칙.
// 기억 저장소(localStorage)는 실제로 써서 「기억을 지운다/남긴다」를 결과로 확인한다.
// @vitest-environment jsdom
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { memoryStorage } from '@/test/memoryStorage'

import type { DriveSpace } from '../types/drive'
import { readDriveSaveLocation, writeDriveSaveLocation } from './driveSaveLocation'
import { type FolderPathResult, resolveInitialSaveLocation } from './resolveInitialSaveLocation'

const owner = { userId: 1, tenantId: 10 }
const space = (id: number, type: DriveSpace['type'] = 'TEAM'): DriveSpace =>
  ({ id, type, name: `s${id}`, ownerId: 1, role: 'OWNER', archived: false, createdAt: '' }) as DriveSpace
const CANDIDATES = [space(1, 'PERSONAL'), space(5)]
const PATH_OK: FolderPathResult = { ok: true, path: [{ id: 3, name: '상위' }, { id: 7, name: '기억폴더' }] }
const httpError = (status: number): FolderPathResult => ({
  ok: false,
  error: new AxiosError('x', undefined, undefined, undefined, { status } as never),
})

const resolve = (remembered: { spaceId: number; folderId: number | null } | null, pathResult: FolderPathResult | null) => {
  if (remembered) writeDriveSaveLocation(owner, remembered)
  return resolveInitialSaveLocation({ remembered, owner, candidates: CANDIDATES, personalSpaceId: 1, pathResult })
}

describe('resolveInitialSaveLocation', () => {
  // 실행하는 Node 버전과 무관하게 같은 저장소로 — Node 25+ 의 전역 localStorage 는 --localstorage-file 없이 메서드가 없다.
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('기억이 없으면 개인 루트', () => {
    expect(resolve(null, null)).toEqual({ spaceId: 1 })
  })

  it('후보에 없는 공간이면 개인 루트(기억은 둔다)', () => {
    expect(resolve({ spaceId: 99, folderId: null }, null)).toEqual({ spaceId: 1 })
    expect(readDriveSaveLocation(owner)).not.toBeNull()
  })

  it('폴더 없이 공간만 기억하면 그 공간 루트', () => {
    expect(resolve({ spaceId: 5, folderId: null }, null)).toEqual({ spaceId: 5 })
  })

  it('경로 조회가 성공하고 마지막 id 가 맞으면 그 공간·경로', () => {
    expect(resolve({ spaceId: 5, folderId: 7 }, PATH_OK)).toEqual({ spaceId: 5, initialTrail: PATH_OK.ok ? PATH_OK.path : [] })
  })

  it('마지막 id 가 다르면 기억을 지우고 개인 루트', () => {
    expect(resolve({ spaceId: 5, folderId: 8 }, PATH_OK)).toEqual({ spaceId: 1 })
    expect(readDriveSaveLocation(owner)).toBeNull()
  })

  it('404 면 기억을 지우고 개인 루트', () => {
    expect(resolve({ spaceId: 5, folderId: 7 }, httpError(404))).toEqual({ spaceId: 1 })
    expect(readDriveSaveLocation(owner)).toBeNull()
  })

  it('5xx·네트워크 오류면 개인 루트이고 기억은 남긴다', () => {
    expect(resolve({ spaceId: 5, folderId: 7 }, httpError(500))).toEqual({ spaceId: 1 })
    expect(readDriveSaveLocation(owner)).toEqual({ spaceId: 5, folderId: 7 })
    expect(resolve({ spaceId: 5, folderId: 7 }, { ok: false, error: new Error('network') })).toEqual({ spaceId: 1 })
    expect(readDriveSaveLocation(owner)).toEqual({ spaceId: 5, folderId: 7 })
  })
})
