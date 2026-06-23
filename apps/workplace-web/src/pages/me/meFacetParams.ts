// URL SearchParams → useMeIssues 에 합칠 facet query 파라미터(status/priority CSV).
// 컴포넌트와 분리(react-refresh) — 횡단 "내 작업"/"AI 위임" 페이지가 공유.
import { parseFilters } from '../../lib/issueFilters'

// yyyy-MM-dd(로컬) — 마감일(LocalDate) 비교용. 홈 합성 레이어의 '오늘 마감' 카운트와 동일 정의를 써야
// 카운트와 필터된 목록이 UTC/로컬 경계에서 어긋나지 않는다.
function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// parseFilters 로 읽어 알려진 enum 토큰만 통과(잘못된 URL 입력 방어). 비어 있으면 키 생략.
export function meFacetParams(params: URLSearchParams): Record<string, string> {
  const f = parseFilters(params)
  const out: Record<string, string> = {}
  if (f.statuses.length) out.status = f.statuses.join(',')
  if (f.priorities.length) out.priority = f.priorities.join(',')
  // 마감 범위(dueFrom/dueTo) 직통과 — 내 작업 위젯 '마감 임박' 그룹 딥링크(?dueTo=오늘+1) 등.
  if (f.dueFrom) out.dueFrom = f.dueFrom
  if (f.dueTo) out.dueTo = f.dueTo
  // 막힘(blocked) 필터 — 내 작업 위젯 '막힘' 그룹 딥링크(?blocked=true). 백엔드 /me/issues 가 이미 지원.
  if (f.blocked) out.blocked = 'true'
  // 홈 '오늘 마감' 셀 딥링크(#275) — dueDate=today 를 오늘 날짜 범위(dueFrom=dueTo=오늘)로 변환해
  // 서버의 DUE_DATE 필터로 합친다. URL 은 ?dueDate=today 로 안정 유지(북마크 가능).
  if (params.get('dueDate') === 'today') {
    const today = localDateKey(new Date())
    out.dueFrom = today
    out.dueTo = today
  }
  return out
}
