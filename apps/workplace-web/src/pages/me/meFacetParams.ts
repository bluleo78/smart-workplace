// URL SearchParams → useMeIssues 에 합칠 facet query 파라미터(status/priority CSV).
// 컴포넌트와 분리(react-refresh) — 횡단 "내 작업"/"AI 위임" 페이지가 공유.
import { parseFilters } from '../../lib/issueFilters'

// parseFilters 로 읽어 알려진 enum 토큰만 통과(잘못된 URL 입력 방어). 비어 있으면 키 생략.
export function meFacetParams(params: URLSearchParams): Record<string, string> {
  const f = parseFilters(params)
  const out: Record<string, string> = {}
  if (f.statuses.length) out.status = f.statuses.join(',')
  if (f.priorities.length) out.priority = f.priorities.join(',')
  return out
}
