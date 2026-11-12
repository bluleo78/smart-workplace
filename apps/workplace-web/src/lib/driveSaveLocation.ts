// 「드라이브에 저장」 마지막 저장 위치 기억(WP-1526) — 사용자·워크스페이스별 localStorage 에 공간·폴더를 남겨 다음 저장 창이 그 자리로 열리게 한다.
import { readStored, writeStored } from './storageWithFallback'
import { type StorageOwner, userScopedKey } from './userScopedKey'

const STORAGE_BASE = 'drive-save-location'

/** 마지막으로 저장한 위치 — folderId null 은 공간 루트. */
export interface DriveSaveLocation {
  spaceId: number
  folderId: number | null
}

/** 기억한 위치 — 없거나 JSON 이 아니거나 모양이 틀리면 null(저장소 값은 믿지 않고 검사한다). */
export function readDriveSaveLocation(owner: StorageOwner): DriveSaveLocation | null {
  const raw = readStored(userScopedKey(STORAGE_BASE, owner))
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { spaceId, folderId } = v as Record<string, unknown>
    if (typeof spaceId !== 'number') return null
    if (folderId !== null && typeof folderId !== 'number') return null
    return { spaceId, folderId }
  } catch {
    return null
  }
}

/** 기억한 위치를 지운다 — 그 폴더가 없어진 것이 확인됐을 때. */
export function clearDriveSaveLocation(owner: StorageOwner): void {
  writeStored(userScopedKey(STORAGE_BASE, owner), null)
}

/** 저장한 위치를 기억한다. */
export function writeDriveSaveLocation(owner: StorageOwner, loc: DriveSaveLocation): void {
  writeStored(userScopedKey(STORAGE_BASE, owner), JSON.stringify(loc))
}
