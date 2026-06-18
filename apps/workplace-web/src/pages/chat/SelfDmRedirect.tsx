// self-DM 진입점 — 본인만의 DM 을 find-or-create 한 뒤 실제 /chat/dms/{id} 로 치환 이동한다.
// 사이드바의 고정 "나" 항목이 이 경로(/chat/dms/self)로 링크된다.
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCreateDm } from '@/hooks/queries/useCreateDm'
import { useAuth } from '@/hooks/useAuth'
import { handleApiError } from '@/lib/api-error'

export default function SelfDmRedirect() {
  const navigate = useNavigate()
  const { user } = useAuth()
  // mutateAsync 는 TanStack Query v5 에서 reference-stable → effect deps 로 안전.
  // (createDm 객체 전체는 매 렌더 새로 생성되어 effect 재실행을 유발하므로 구조분해)
  const { mutateAsync } = useCreateDm()
  const started = useRef(false) // StrictMode 이중 실행 방지

  useEffect(() => {
    if (started.current || !user) return
    started.current = true
    mutateAsync([user.id]) // 본인 id → size 1 self-DM
      .then((dm) => navigate(`/chat/dms/${dm.id}`, { replace: true }))
      .catch((err) => {
        handleApiError(err, '개인 메모를 열 수 없습니다')
        navigate('/chat', { replace: true })
      })
  }, [user, mutateAsync, navigate])

  return (
    <div className="p-4 text-sm text-muted-foreground" data-testid="self-dm-loading">
      개인 메모 여는 중…
    </div>
  )
}
