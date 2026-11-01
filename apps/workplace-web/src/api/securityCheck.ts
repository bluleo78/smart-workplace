// WP-1262: HTML 파일 AI 보안 점검 API — 출처별 경로(ViewerItem.securityCheckPath)에 GET(조회)·POST(요청).
import type { SecurityCheckView } from '../types/securityCheck'
import { stripApiPrefix } from './blobContent'
import { client } from './client'

export const securityCheckApi = {
  /** 저장된 점검 결과 조회. */
  get: (path: string) => client.get<SecurityCheckView>(stripApiPrefix(path)),
  /** 점검 요청(다시 점검 포함) — 갱신된 뷰를 돌려준다. */
  request: (path: string) => client.post<SecurityCheckView>(stripApiPrefix(path)),
}
