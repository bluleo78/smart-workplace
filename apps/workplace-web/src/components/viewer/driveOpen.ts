// ⋯ "드라이브에서 열기" 대상 경로 해석(WP-277).
import { driveApi } from '../../api/drive'
import type { DriveSearchResult } from '../../types/drive'
import type { DriveOpenTarget } from './types'

/**
 * 드라이브 페이지에서 파일을 미리보기로 여는 경로 — DrivePage 의 폴더 라우트(`?folderId=`)와 미리보기(`?preview=`) 규칙을 따른다.
 * 왜 폴더까지: DrivePage 는 ?preview 를 "현재 폴더" 목록에서만 찾으므로 폴더 없이 열면 하위 폴더 파일이 "찾을 수 없음"이 된다.
 */
export function driveFilePath(spaceId: number, folderId: number | null, driveFileId: number): string {
  return driveFolderPathWith(spaceId, folderId, 'preview', driveFileId)
}

/** 「드라이브에서 열기」 도착 파라미터(WP-1732) — DrivePage 가 이 파일 행을 잠시 강조하고 스크롤한 뒤 주소에서 지운다. */
export const DRIVE_HIGHLIGHT_PARAM = 'highlight'

/**
 * 파일이 든 폴더 목록을 열고 그 파일 행을 강조하는 경로(WP-1732) — 「드라이브에서 열기」 전용.
 * 왜 따로: driveFilePath(?preview)는 「파일 자체를 여는」 링크(검색 결과·복사 링크·앱 링크 카드·가져오기 토스트)라 뷰어를 연다.
 * 「드라이브에서 열기」는 파일이 드라이브 어디에 있는지 보여 주는 것이라 뷰어 없이 목록에서 그 행을 가리킨다.
 */
export function driveFileLocatePath(spaceId: number, folderId: number | null, driveFileId: number): string {
  return driveFolderPathWith(spaceId, folderId, DRIVE_HIGHLIGHT_PARAM, driveFileId)
}

/** 공간의 폴더 경로(`?folderId=`, 루트면 생략)에 파일 id 파라미터 하나를 붙인다 — 미리보기·도착 강조 경로가 같은 규칙을 쓴다. */
function driveFolderPathWith(spaceId: number, folderId: number | null, param: string, driveFileId: number): string {
  const qs = new URLSearchParams()
  if (folderId != null) qs.set('folderId', String(folderId))
  qs.set(param, String(driveFileId))
  return `/drive/spaces/${spaceId}?${qs.toString()}`
}

/**
 * 링크된 드라이브 파일이 있는 폴더를 찾아 그 폴더 목록에서 파일 행을 강조하는 경로를 만든다(WP-1732 — 뷰어가 아니라 목록).
 * 드라이브 링크 응답에는 폴더 id 가 없고 단건 조회 API 도 없어, 기존 공간 이름 검색(파일명 부분 일치)에서
 * 같은 id 의 파일을 골라 그 folderId 를 쓴다. 검색 실패·미발견(이름 2자 미만은 서버가 빈 결과)이면 공간 루트로 연다 —
 * 루트에 있으면 강조되고, 없으면 강조할 것 없이 목록만 보인다.
 * @param search 테스트용 주입 — 기본은 driveApi.search.
 */
export async function resolveDriveOpenPath(
  target: DriveOpenTarget,
  search: (spaceId: number, q: string) => Promise<DriveSearchResult> = (sid, q) =>
    driveApi.search(sid, q).then((r) => r.data),
): Promise<string> {
  try {
    const res = await search(target.spaceId, target.name)
    const hit = res.files.find((f) => f.id === target.driveFileId)
    if (hit) return driveFileLocatePath(target.spaceId, hit.folderId, target.driveFileId)
  } catch {
    // 검색 실패는 루트 경로로 대신한다 — 메뉴 동작 자체를 막지 않는다.
  }
  return driveFileLocatePath(target.spaceId, null, target.driveFileId)
}
