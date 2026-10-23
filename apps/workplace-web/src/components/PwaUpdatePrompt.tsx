// src/components/PwaUpdatePrompt.tsx
// 서비스워커 등록 + 새 버전 알림. 새 SW 가 대기하면 토스트로 알리고, 사용자가 누를 때만 활성화·새로고침한다(편집 중 데이터 보호).
// 등록 후에는 주기·화면 복귀 시점에 업데이트를 확인해, 열려 있는 앱에서도 새 배포를 감지한다(WP-226).
// 누른 창은 SW 관리 밖(강제 새로고침)이어도 활성화를 기다려 새로고침하고, 같은 브라우저의 다른 창은
// 새 SW 가 활성화되면 함께 새로고침해 옛 버전에 남지 않는다 — 저장 안 한 입력이 있는 창은 안내만 한다(WP-664).
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'

import { applyWaitingUpdate, isApplyingUpdate, watchControllerUpdate } from '@/lib/pwa/applyUpdate'
import { startSwUpdateChecks } from '@/lib/pwa/updateCheck'
import { hasUnsavedInput } from '@/lib/unsavedInput'

const reload = () => window.location.reload()

/** 새 버전 토스트 — 대기 알림과 적용 안내가 같은 자리(id)를 쓴다. */
function showUpdateToast(title: string, onRefresh: () => void) {
  toast(title, { id: 'pwa-update', duration: Infinity, action: { label: '새로고침', onClick: onRefresh } })
}

export function PwaUpdatePrompt() {
  // 업데이트 확인 정리 함수 — StrictMode 로 등록 콜백이 두 번 불려도 확인 타이머·리스너가 겹치지 않게 보관한다.
  // 앱 루트에 한 번만 마운트되어 언마운트되지 않으므로 별도 정리 effect 는 두지 않는다.
  const stopChecksRef = useRef<(() => void) | null>(null)
  // workbox 가 관리하는 등록 — 토스트를 누를 때 대기 중인 SW 를 여기서 찾는다.
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // 플러그인의 기본 새로고침(토스트를 띄운 창만, controlling 때)은 끈다 — 모든 창을 watchControllerUpdate 한 경로로 처리한다.
    onNeedReload: () => {},
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      registrationRef.current = registration
      stopChecksRef.current?.()
      stopChecksRef.current = startSwUpdateChecks(registration)
    },
  })

  // 다른 창이 새 버전을 적용했을 때 — 바로 새로고침, 저장 안 한 입력이 있으면 안내만.
  // 등록(window load 뒤)을 기다리지 않고 마운트 즉시 건다 — 로드 중에 다른 창이 적용해도 놓치지 않게.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    return watchControllerUpdate(navigator.serviceWorker, () => {
      // 이 창이 직접 적용 중이면(토스트·404 복구) 적용하는 쪽이 새로고침한다.
      if (isApplyingUpdate()) return
      if (hasUnsavedInput()) showUpdateToast('새 버전이 적용됐습니다', reload)
      else reload()
    })
  }, [])

  useEffect(() => {
    if (!needRefresh) return
    // 「새로고침」 — 대기 중인 SW 를 활성화하고 활성화된 뒤 새로고침. 더 새 SW 에 밀려 적용되지 않으면 토스트를 다시 띄워
    // 새 대기 SW 로 다시 시도하게 하고, 도중에 실패하면 새로고침이라도 해 다시 확인하게 한다.
    const apply = async () => {
      try {
        // 등록 콜백보다 대기 알림이 먼저 올 수 있어, 아직 등록을 모르면 직접 찾는다.
        const registration = registrationRef.current ?? (await navigator.serviceWorker.getRegistration())
        const applied = await applyWaitingUpdate(registration?.waiting ?? null, updateServiceWorker, reload)
        if (!applied) {
          showUpdateToast('새 버전이 있습니다', () => void apply())
        }
      } catch {
        reload()
      }
    }
    showUpdateToast('새 버전이 있습니다', () => void apply())
  }, [needRefresh, updateServiceWorker])

  return null
}
