// WP-1262: AI 패널(데스크톱 사이드 패널·모바일 시트·✨ 단추) 노출 판정 — 요약 + 보안 점검을 합친다.
import { useSecurityCheck } from '../../hooks/queries/useSecurityCheck'
import type { ViewerItem } from './types'
import { type SummaryAvailability, useSummaryAvailability } from './useSummaryAvailability'

/**
 * - summary: 기존 요약 판정 그대로.
 * - security: 점검 경로가 있고 점검이 실제로 돌았거나 도는 중일 때(CHECKING·DONE·FAILED). 행이 없거나(null)·대기(PENDING)·건너뜀(SKIPPED)·조회 중이면 거짓.
 *   PENDING 을 빼는 이유: 업로드 직후엔 스크립트 없는 HTML 도 잠깐 PENDING 을 거쳐(서버가 요지를 본 뒤 SKIPPED 로 바꾼다) 패널이 「점검 중」으로 깜빡 열리기 때문.
 * - show: 둘 중 하나라도 있으면 ✨·패널을 보인다.
 * - title: 패널·시트 제목 — 요약이 있으면 「AI 요약」, 보안 점검 카드만 있으면 「보안 점검」.
 * 점검 조회는 스크립트 유무와 무관하게 켠다(스크립트 판정은 문서를 읽는 안내 줄만 안다) — 쿼리 캐시는 안내 줄과 공유한다.
 */
export interface PanelAvailability {
  summary: SummaryAvailability
  security: boolean
  show: boolean
  title: string
}

export function usePanelAvailability(item: ViewerItem): PanelAvailability {
  const summary = useSummaryAvailability(item)
  const { view } = useSecurityCheck(item.securityCheckPath, true)
  const status = view?.status
  const security =
    !!item.securityCheckPath &&
    (status === 'CHECKING' || status === 'DONE' || status === 'FAILED')
  return { summary, security, show: summary === 'show' || security, title: summary === 'show' ? 'AI 요약' : '보안 점검' }
}
