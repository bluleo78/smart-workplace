// src/components/PwaUpdatePrompt.tsx
// 서비스워커 등록 + 새 버전 알림. 새 SW 가 대기하면 토스트로 알리고, 사용자가 누를 때만 활성화·새로고침한다(편집 중 데이터 보호).
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

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
