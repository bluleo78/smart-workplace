// src/pages/settings/NotificationSettingsPage.tsx
// 설정 > 개인 > 알림 — 이 기기 푸시 on/off 와 사용자 단위 종류별 설정. iOS 미설치·권한 거부·서버 비활성 상태를 안내한다.
import { useState } from 'react'

import { SettingsPage } from '@/components/layout/SettingsPage'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  useDevicePush,
  useDisablePush,
  useEnablePush,
  usePushConfig,
  usePushPreferences,
  useUpdatePushPreference,
} from '@/hooks/queries/usePush'
import { requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport, type PushSupport } from '@/lib/push/support'
import type { PushCategory } from '@/types/push'

const CATEGORIES: { key: PushCategory; label: string; description: string }[] = [
  { key: 'DM', label: '다이렉트 메시지', description: '나에게 온 DM' },
  { key: 'MENTION', label: '채널 멘션', description: '채널에서 나를 멘션한 메시지' },
  { key: 'ISSUE', label: '이슈', description: '배정·코멘트·상태·우선순위 변경' },
  { key: 'CALENDAR', label: '캘린더', description: '일정 초대·참석 응답·리마인더' },
]

export default function NotificationSettingsPage() {
  const config = usePushConfig()
  const enabled = config.data?.enabled === true
  const prefs = usePushPreferences(enabled)
  const updatePref = useUpdatePushPreference()
  const device = useDevicePush()
  const enablePush = useEnablePush()
  const disablePush = useDisablePush()
  // 권한 요청 결과로 바뀌므로 상태로 들고 클릭 후 다시 읽는다.
  const [support, setSupport] = useState<PushSupport>(() => getPushSupport())

  const subscribed = device.data?.subscribed === true
  const busy = enablePush.isPending || disablePush.isPending
  // 이번 요청이 거부/닫힘으로 끝났는지 — 창을 닫기만 하면 permission 이 'default' 로 남으므로 결과로도 판단한다.
  const deniedNow = enablePush.error instanceof Error && enablePush.error.message === 'PERMISSION_DENIED'

  // 토글 클릭 — 권한 요청을 이 핸들러에서 동기 호출(사용자 제스처 유지)하고 Promise 를 넘긴다.
  const onToggleDevice = (next: boolean) => {
    if (next) {
      const key = config.data?.vapidPublicKey
      if (!key) return
      const permission = requestPushPermission()
      enablePush.mutate({ vapidPublicKey: key, permission }, { onSettled: () => setSupport(getPushSupport()) })
    } else {
      disablePush.mutate()
    }
  }

  return (
    <SettingsPage title="알림" width="form" data-testid="notification-settings-page">
      {config.isSuccess && !enabled && (
        <Card data-testid="push-disabled-notice">
          <CardHeader>
            <CardTitle>푸시 알림을 사용할 수 없습니다</CardTitle>
            <CardDescription>이 서버에서는 푸시 알림이 꺼져 있습니다. 앱을 열어 둔 동안에는 인박스로 알림을 받습니다.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>이 기기</CardTitle>
              <CardDescription>앱을 닫아도 이 기기로 알림을 받습니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm">이 기기에서 푸시 받기</span>
                <Switch
                  data-testid="push-device-toggle"
                  checked={subscribed}
                  disabled={busy || support === 'ios-needs-install' || support === 'unsupported'}
                  onCheckedChange={onToggleDevice}
                  aria-label="이 기기에서 푸시 받기"
                />
              </div>
              {support === 'ios-needs-install' && (
                <p className="rounded-md bg-muted p-3 text-sm" data-testid="push-ios-install-guide">
                  iPhone·iPad 에서는 홈 화면에 추가한 앱에서만 알림을 받을 수 있습니다. Safari 의 공유 버튼 → “홈 화면에 추가”를 누른
                  뒤, 홈 화면의 Gen:iA 앱에서 다시 켜 주세요.
                </p>
              )}
              {(support === 'denied' || deniedNow) && (
                <p className="rounded-md bg-muted p-3 text-sm" data-testid="push-denied-guide">
                  알림 권한이 차단되어 있습니다. 브라우저 주소창의 사이트 설정(또는 OS 설정 &gt; 알림)에서 이 사이트의 알림을 허용해 주세요.
                </p>
              )}
              {support === 'unsupported' && (
                <p className="text-sm text-muted-foreground" data-testid="push-unsupported">
                  이 브라우저는 푸시 알림을 지원하지 않습니다.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>알림 종류</CardTitle>
              <CardDescription>모든 기기에 공통으로 적용됩니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {CATEGORIES.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{c.description}</p>
                  </div>
                  <Switch
                    data-testid={`push-pref-${c.key}`}
                    checked={prefs.data?.[c.key] ?? true}
                    // 저장 요청이 진행 중이면 전부 비활성화 — 하나의 뮤테이션(updatePref)을 네 토글이 공유하므로,
                    // 응답 오기 전에 다른 종류를 또 누르면 부분 업데이트(PUT body 는 바뀐 필드만)가 겹쳐 순서에 따라
                    // 먼저 보낸 요청의 결과가 나중 응답으로 덮어써질 수 있다.
                    disabled={!prefs.isSuccess || updatePref.isPending}
                    onCheckedChange={(v) => updatePref.mutate({ category: c.key, enabled: v })}
                    aria-label={c.label}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </SettingsPage>
  )
}
