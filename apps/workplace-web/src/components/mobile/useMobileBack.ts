// 모바일 뒤로가기 동작 — 히스토리가 있으면 한 단계 뒤로, 없으면(딥링크) 모듈 루트로 교체 이동해 앱 밖으로 나가지 않게 한다.
// 뒤로가기 바(MobileBackBar)·병합 상세 헤더(MobileDetailBar)가 같은 규칙을 공유하도록 한곳에 둔다.
import { useLocation, useNavigate } from 'react-router-dom'

import { currentHistoryIdx } from '@/lib/historyParam'
import { resolveBackTarget } from '@/lib/mobile/routes'

/**
 * fallback: 돌아갈 기록이 없을 때(딥링크) 모듈 루트 대신 갈 경로상 한 단계 위 주소.
 * 같은 경로 안에서 쿼리로 위치가 갈리는 화면(연락처 조직도 ?group=…)은 모듈 루트로 가면 상위가 아닌 첫 화면이 되므로 넘긴다(WP-977, §B-1).
 */
export function useMobileBack(fallback?: string) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return () => {
    const target = resolveBackTarget(pathname, currentHistoryIdx())
    if (target === -1) navigate(-1)
    else navigate(fallback ?? (target as string), { replace: true })
  }
}
