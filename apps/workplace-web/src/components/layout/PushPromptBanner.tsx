// src/components/layout/PushPromptBanner.tsx
// 인박스 상단 "알림 켜기" 배너 — 서버 푸시 가능 + 권한 미결정 + 미구독 + 닫은 적 없음일 때 1회 노출. 자동 권한 요청은 하지 않는다.
import { BellRing, X } from 'lucide-react'
import { useState } from 'react'

import { useDevicePush, useEnablePush, usePushConfig } from '@/hooks/queries/usePush'
import { requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport } from '@/lib/push/support'

const DISMISS_KEY = 'pushPromptDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function PushPromptBanner() {
  const config = usePushConfig()
  const device = useDevicePush()
  const enablePush = useEnablePush()
  const [dismissed, setDismissed] = useState(readDismissed)

  const key = config.data?.vapidPublicKey
  if (dismissed || !config.data?.enabled || !key) return null
  if (device.data?.subscribed !== false || getPushSupport() !== 'default') return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // 저장 불가(시크릿 모드) — 이번 세션만 숨김
    }
    setDismissed(true)
  }

  return (
    <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs" data-testid="push-prompt-banner">
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">앱을 닫아도 알림을 받아 보세요</span>
      <button
        type="button"
        className="font-medium text-primary hover:underline"
        disabled={enablePush.isPending}
        onClick={() => enablePush.mutate({ vapidPublicKey: key, permission: requestPushPermission() }, { onSettled: dismiss })}
        data-testid="push-prompt-enable"
      >
        알림 켜기
      </button>
      <button type="button" aria-label="배너 닫기" onClick={dismiss} data-testid="push-prompt-dismiss">
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}
