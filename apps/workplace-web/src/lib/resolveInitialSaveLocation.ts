// 「드라이브에 저장」 처음 위치 해석(WP-1526) — 기억한 마지막 저장 위치를 지금 쓸 수 있는 공간·폴더 경로로 바꾼다.
import { isAxiosError } from 'axios'

import type { DriveFolderPathSegment, DriveSpace } from '../types/drive'
import { clearDriveSaveLocation, type DriveSaveLocation } from './driveSaveLocation'
import type { StorageOwner } from './userScopedKey'

/** 폴더 경로 조회 결과 — 오류를 던지지 않고 값으로 받아, 공간 목록 조회와 Promise.all 로 동시에 돌려도 한쪽 실패가 다른 쪽을 가리지 않게 한다. */
export type FolderPathResult = { ok: true; path: DriveFolderPathSegment[] } | { ok: false; error: unknown }

/** 처음 위치 — spaceId 는 처음 공간, initialTrail 은 기억한 폴더의 루트→폴더 경로(없으면 공간 루트). */
export interface InitialSaveLocation {
  spaceId: number
  initialTrail?: DriveFolderPathSegment[]
}

/**
 * 기억한 위치를 처음 위치로 풀어낸다. 기억을 믿을 수 없으면 내 드라이브 루트(personalSpaceId)로 연다.
 * - 기억이 없거나 후보 공간(candidates)에 없다(보관·권한 상실): 개인 루트. 기억은 그대로 둔다.
 * - 폴더 없이 공간만 기억: 그 공간 루트.
 * - 경로 조회 성공 + 마지막 id 가 기억한 폴더: 그 공간·경로. 마지막 id 불일치는 위치를 믿을 수 없어 기억을 지우고 개인 루트.
 * - 조회 오류: 404 면 폴더가 없어진 것이라 기억을 지우고, 5xx·네트워크 등 일시 오류는 기억을 남긴 채 이번만 개인 루트.
 * 경로 응답에는 공간 정보가 없어 폴더가 그 공간 소속인지까지는 확인하지 못한다.
 * @param pathResult 기억한 folderId 의 경로 조회 결과 — folderId 가 null 이면 조회하지 않았으므로 null.
 */
export function resolveInitialSaveLocation(args: {
  remembered: DriveSaveLocation | null
  owner: StorageOwner | null
  candidates: DriveSpace[]
  personalSpaceId: number
  pathResult: FolderPathResult | null
}): InitialSaveLocation {
  const { remembered, owner, candidates, personalSpaceId, pathResult } = args
  const root: InitialSaveLocation = { spaceId: personalSpaceId }
  if (!remembered || !candidates.some((s) => s.id === remembered.spaceId)) return root
  if (remembered.folderId == null) return { spaceId: remembered.spaceId }
  if (!pathResult) return root
  if (!pathResult.ok) {
    if (owner && isAxiosError(pathResult.error) && pathResult.error.response?.status === 404) clearDriveSaveLocation(owner)
    return root
  }
  if (pathResult.path.at(-1)?.id !== remembered.folderId) {
    if (owner) clearDriveSaveLocation(owner)
    return root
  }
  return { spaceId: remembered.spaceId, initialTrail: pathResult.path }
}
