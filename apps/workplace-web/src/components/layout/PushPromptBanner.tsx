// src/components/layout/PushPromptBanner.tsx
// 인박스 상단 "알림 켜기" 배너 — 서버 푸시 가능 + 권한 미결정 + 미구독 + 닫은 적 없음일 때 1회 노출. 자동 권한 요청은 하지 않는다.
import { BellRing, X } from 'lucide-react'

import { useDevicePush, useEnablePush, usePushConfig } from '@/hooks/queries/usePush'
import { usePersistentToggle } from '@/hooks/usePersistentToggle'
import { requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport } from '@/lib/push/support'

// 닫음 여부는 기기별로 영속('1' = 닫음). 저장 불가(시크릿 모드)면 이번 세션만 숨긴다 — usePersistentToggle 이 처리.
const DISMISS_KEY = 'pushPromptDismissed'

export function PushPromptBanner() {
  const config = usePushConfig()
  const device = useDevicePush()
  const enablePush = useEnablePush()
  const [dismissed, , setDismissed] = usePersistentToggle(DISMISS_KEY, false)

  const key = config.data?.vapidPublicKey
  if (dismissed || !config.data?.enabled || !key) return null
  if (device.data?.subscribed !== false || getPushSupport() !== 'default') return null

  const dismiss = () => setDismissed(true)

  return (
    <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs" data-testid="push-prompt-banner">
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">앱을 닫아도 알림을 받아 보세요</span>
      {/* WP-922: 두 버튼 모두 보이는 크기는 작게 두고 보이지 않는 ::after 로 터치 영역을 44px 이상으로 넓힌다(10-accessibility §I).
          배너 높이는 그대로 — 넓힌 영역은 absolute 라 레이아웃을 밀지 않는다. */}
      <button
        type="button"
        className="relative font-medium text-primary hover:underline after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
        disabled={enablePush.isPending}
        onClick={() => enablePush.mutate({ vapidPublicKey: key, permission: requestPushPermission() }, { onSettled: dismiss })}
        data-testid="push-prompt-enable"
      >
        알림 켜기
      </button>
      <button
        type="button"
        aria-label="배너 닫기"
        onClick={dismiss}
        className="relative -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded after:absolute after:-inset-2 after:content-['']"
        data-testid="push-prompt-dismiss"
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  )
}
