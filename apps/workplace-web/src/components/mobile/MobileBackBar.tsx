// 모바일 상세 화면 상단 뒤로가기 바 — ‹ + 모듈 제목 + 우측 ✦(AI).
// 히스토리가 없으면(딥링크) 모듈 루트로 replace. 상세에선 탭바가 숨으므로 ✦ 가 AI 진입점이다(스펙 3.9) —
// 페이지가 등록한 화면 컨텍스트(AiScreenContext)를 그대로 가진 채 풀스크린을 연다.
import { ChevronLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { resolveBackTarget } from '@/lib/mobile/routes'

import { DetailAiButton } from './DetailAiButton'

export function MobileBackBar({ title }: { title: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 히스토리가 있으면 한 단계 뒤로, 없으면(딥링크) 모듈 루트로 교체 이동해 앱 밖으로 나가지 않게 한다.
  const onBack = () => {
    const target = resolveBackTarget(pathname, (window.history.state as { idx?: number } | null)?.idx)
    if (target === -1) navigate(-1)
    else navigate(target as string, { replace: true })
  }
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-background px-1">
      <button
        type="button"
        data-testid="mobile-back"
        aria-label="뒤로"
        onClick={onBack}
        className="flex h-11 min-w-11 items-center justify-center text-primary"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>
      <span data-testid="mobile-back-title" className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{title}</span>
      <DetailAiButton data-testid="mobile-back-ai" />
    </div>
  )
}
