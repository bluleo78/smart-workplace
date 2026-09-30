// 모바일 뒤로가기 동작 — 히스토리가 있으면 한 단계 뒤로, 없으면(딥링크) 모듈 루트로 교체 이동해 앱 밖으로 나가지 않게 한다.
// 뒤로가기 바(MobileBackBar)·병합 상세 헤더(MobileDetailBar)가 같은 규칙을 공유하도록 한곳에 둔다.
import { useLocation, useNavigate } from 'react-router-dom'

import { resolveBackTarget } from '@/lib/mobile/routes'

export function useMobileBack() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return () => {
    const target = resolveBackTarget(pathname, (window.history.state as { idx?: number } | null)?.idx)
    if (target === -1) navigate(-1)
    else navigate(target as string, { replace: true })
  }
}
