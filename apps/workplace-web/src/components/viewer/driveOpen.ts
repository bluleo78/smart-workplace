// ⋯ "드라이브에서 열기" 대상 경로 해석(WP-277).
import { driveApi } from '../../api/drive'
import type { DriveSearchResult } from '../../types/drive'
import type { DriveOpenTarget } from './types'

/**
 * 드라이브 페이지에서 파일을 미리보기로 여는 경로 — DrivePage 의 폴더 라우트(`?folderId=`)와 미리보기(`?preview=`) 규칙을 따른다.
 * 왜 폴더까지: DrivePage 는 ?preview 를 "현재 폴더" 목록에서만 찾으므로 폴더 없이 열면 하위 폴더 파일이 "찾을 수 없음"이 된다.
 */
export function driveFilePath(spaceId: number, folderId: number | null, driveFileId: number): string {
  const qs = new URLSearchParams()
  if (folderId != null) qs.set('folderId', String(folderId))
  qs.set('preview', String(driveFileId))
  return `/drive/spaces/${spaceId}?${qs.toString()}`
}

/**
 * 링크된 드라이브 파일이 있는 폴더를 찾아 열 경로를 만든다.
 * 드라이브 링크 응답에는 폴더 id 가 없고 단건 조회 API 도 없어, 기존 공간 이름 검색(파일명 부분 일치)에서
 * 같은 id 의 파일을 골라 그 folderId 를 쓴다. 검색 실패·미발견(이름 2자 미만은 서버가 빈 결과)이면 공간 루트로 연다.
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
    if (hit) return driveFilePath(target.spaceId, hit.folderId, target.driveFileId)
  } catch {
    // 검색 실패는 루트 경로로 대신한다 — 메뉴 동작 자체를 막지 않는다.
  }
  return driveFilePath(target.spaceId, null, target.driveFileId)
}
