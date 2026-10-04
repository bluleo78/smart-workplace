// src/components/PwaUpdatePrompt.tsx
// 서비스워커 등록 + 새 버전 알림. 새 SW 가 대기하면 토스트로 알리고, 사용자가 누를 때만 활성화·새로고침한다(편집 중 데이터 보호).
// 등록 후에는 주기·화면 복귀 시점에 업데이트를 확인해, 열려 있는 앱에서도 새 배포를 감지한다(WP-226).
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { startSwUpdateChecks } from '@/lib/pwa/updateCheck'

export function PwaUpdatePrompt() {
  // 업데이트 확인 정리 함수 — 등록 콜백이 다시 불려도 확인 타이머·리스너가 겹치지 않게 보관한다.
  const stopChecksRef = useRef<(() => void) | null>(null)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      stopChecksRef.current?.()
      stopChecksRef.current = startSwUpdateChecks(registration)
    },
  })

  useEffect(() => () => stopChecksRef.current?.(), [])

  useEffect(() => {
    if (!needRefresh) return
    toast('새 버전이 있습니다', {
      id: 'pwa-update',
      duration: Infinity,
      action: { label: '새로고침', onClick: () => void updateServiceWorker(true) },
    })
  }, [needRefresh, updateServiceWorker])

  return null
}
