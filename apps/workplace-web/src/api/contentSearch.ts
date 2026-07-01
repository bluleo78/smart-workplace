import { client } from './client'

/** 콘텐츠 검색 결과 1건 — 파일명·snippet·스페이스 정보. */
export interface DriveContentHit {
  driveFileId: number
  fileId: number
  spaceId: number
  spaceName: string
  name: string
  mimeType: string
  snippet: string
  score: number
}

/** GET /api/v1/drive/search 응답. semantic=true 면 벡터+키워드 하이브리드, false 면 키워드 전용. */
export interface DriveContentSearchResponse {
  hits: DriveContentHit[]
  semantic: boolean
}

/**
 * 콘텐츠 하이브리드 검색 — 키워드(tsvector) + 의미(pgvector) RRF 병합.
 * spaceId 로 결과를 해당 공간으로 제한한다(드라이브 헤더 통합 검색이 항상 현재 공간을 전달).
 */
export async function searchDriveContent(
  q: string,
  spaceId: number,
  limit?: number,
): Promise<DriveContentSearchResponse> {
  const res = await client.get('/drive/search', { params: { q, spaceId, limit } })
  return res.data as DriveContentSearchResponse
}
