// WP-1353 통합 검색 — 모든 공간 드라이브 이름 검색 API(GET /api/v1/search/drive).
import { client } from './client'

/** 드라이브 이름 검색 결과 1건 — FILE 의 folderId 는 담긴 폴더, FOLDER 의 folderId 는 부모 폴더(최상위면 null). */
export interface DriveSearchItem {
  kind: 'FOLDER' | 'FILE'
  id: number
  spaceId: number
  spaceName: string
  folderId: number | null
  name: string
  mimeType: string | null
  /** 폴더 경로 표기 — 최상위면 빈 문자열. */
  folderPath: string
}

export interface DriveSearchPage {
  items: DriveSearchItem[]
  hasMore: boolean
}

/** 이름에 q 가 들어간 파일·폴더를 모든 공간에서 찾는다. offset·size 로 이어 받는다. */
export async function searchDriveByName(q: string, offset: number, size: number, signal?: AbortSignal): Promise<DriveSearchPage> {
  const { data } = await client.get<DriveSearchPage>('/search/drive', { params: { q, offset, size }, signal })
  return data
}
