// src/components/layout/PushPromptBanner.tsx
// 인박스 상단 "알림 켜기" 배너 — 서버 푸시 가능 + 닫은 적 없음일 때 노출. 자동 권한 요청은 하지 않는다.
// - 권한 미결정 + 미구독: 「알림 켜기」 유도
// - 권한 거부(denied): 차단 안내 + 「알림 설정」 링크(WP-1933). 클릭으로 거부당해도 조용히 사라지지 않고 안내로 바뀐다.
// 닫음(X)은 구독 성공·사용자가 X 를 누른 경우에만 저장한다 — 거부·실패에 영구 닫음을 남기면 다시 켤 길이 막힌다.
import { BellRing, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useDevicePush, useEnablePush, usePushConfig } from '@/hooks/queries/usePush'
import { usePersistentToggle } from '@/hooks/usePersistentToggle'
import { requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport, PUSH_DENIED_GUIDE } from '@/lib/push/support'

// 닫음 여부는 기기별로 영속('1' = 닫음). 저장 불가(시크릿 모드)면 이번 세션만 숨긴다 — usePersistentToggle 이 처리.
const DISMISS_KEY = 'pushPromptDismissed'
// 「알림 켜기」·「알림 설정」 공통 모양 — 보이는 크기는 작게 두고 보이지 않는 ::after 로 터치 영역을 44px 이상으로 넓힌다(WP-922).
const ACTION_CLASS = "relative font-medium text-primary hover:underline after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"

export function PushPromptBanner({ onNavigate }: { onNavigate?: () => void }) {
  const config = usePushConfig()
  const device = useDevicePush()
  const enablePush = useEnablePush()
  const [dismissed, , setDismissed] = usePersistentToggle(DISMISS_KEY, false)

  const key = config.data?.vapidPublicKey
  if (dismissed || !config.data?.enabled || !key) return null
  // 지원 상태는 렌더마다 다시 읽는다 — 「알림 켜기」가 거부로 끝나면 뮤테이션 상태 변화(pending → error)로 다시 그려지며 안내형으로 바뀐다.
  const support = getPushSupport()
  if (support !== 'default' && support !== 'denied') return null
  // 구독 여부는 권한 미결정일 때만 따진다(거부 상태 안내는 구독과 무관하게 보인다).
  if (support === 'default' && device.data?.subscribed !== false) return null

  const dismiss = () => setDismissed(true)
  const denied = support === 'denied'

  return (
    <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs" data-testid="push-prompt-banner">
      <BellRing className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1" data-testid={denied ? 'push-prompt-denied' : undefined}>
        {denied ? PUSH_DENIED_GUIDE : '앱을 닫아도 알림을 받아 보세요'}
      </span>
      {/* 배너 높이는 그대로 — 넓힌 터치 영역(ACTION_CLASS 의 ::after)은 absolute 라 레이아웃을 밀지 않는다(10-accessibility §I). */}
      {denied ? (
        <Link to="/settings/notifications" onClick={onNavigate} className={ACTION_CLASS} data-testid="push-prompt-settings-link">
          알림 설정
        </Link>
      ) : (
        <button
          type="button"
          className={ACTION_CLASS}
          disabled={enablePush.isPending}
          onClick={() => enablePush.mutate({ vapidPublicKey: key, permission: requestPushPermission() }, { onSuccess: dismiss })}
          data-testid="push-prompt-enable"
        >
          알림 켜기
        </button>
      )}
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
