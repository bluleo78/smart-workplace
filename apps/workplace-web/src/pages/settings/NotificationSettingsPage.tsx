// src/pages/settings/NotificationSettingsPage.tsx
// 설정 > 개인 > 알림 — 이 기기 푸시 on/off 와 앱별 「사람이 / AI가」 알림 설정(WP-913). iOS 미설치·권한 거부·서버 비활성 상태를 안내한다.
import { useState } from 'react'

import { BusySwitch } from '@/components/BusySwitch'
import { SettingsPage } from '@/components/layout/SettingsPage'
import { SettingsSection, SettingsToggleRow } from '@/components/layout/SettingsSection'
import { NotificationSettingsMatrix } from '@/components/settings/NotificationSettingsMatrix'
import { settingsGuides } from '@/components/settings-guide/settingsGuides'
import { Skeleton } from '@/components/ui/skeleton'
import { useNotificationSettings, useUpdateNotificationSettings } from '@/hooks/queries/useNotificationSettings'
import { useDevicePush, useDisablePush, useEnablePush, usePushConfig } from '@/hooks/queries/usePush'
import { useIsMobile } from '@/hooks/useIsMobile'
import { APP_LABEL, knownApps } from '@/lib/notificationSettingsMeta'
import { requestPushPermission } from '@/lib/push/subscription'
import { getPushSupport, type PushSupport } from '@/lib/push/support'
import type { NotificationAppSetting } from '@/types/notificationSettings'

export default function NotificationSettingsPage() {
  const config = usePushConfig()
  const enabled = config.data?.enabled === true
  // WP-913: 알림 종류 설정은 푸시가 아니라 알림 자체(목록·실시간·푸시)에 적용되므로 푸시 config 와 무관하게 늘 불러온다.
  const settings = useNotificationSettings()
  // 저장 뮤테이션 하나를 모든 스위치가 공유하고, 진행 중엔 매트릭스 전체를 busy 로 잠근다 — 응답 전에 다른 칸을 또 누르면
  // 부분 업데이트가 겹쳐 먼저 보낸 요청의 결과가 나중 응답에 덮어써질 수 있다(WP-847).
  const updateSettings = useUpdateNotificationSettings()
  const device = useDevicePush()
  const isMobile = useIsMobile()
  // 즉시 적용 토글이라 스위치 상태가 피드백 — 성공 토스트는 끈다(오른쪽 끝 토글을 가림).
  const enablePush = useEnablePush({ successToast: false })
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
    <SettingsPage
      title="알림"
      width="form"
      guide={settingsGuides.notifications}
      // WP-414: AI 화면 맥락 — 서버 푸시 사용 여부·이 기기 푸시 켜짐(로드된 값만). 구독 키 등은 싣지 않는다.
      aiContext={{
        facts: [
          ['푸시 알림(서버)', config.isSuccess ? (enabled ? '사용 가능' : '꺼져 있음') : null],
          ['이 기기 푸시', enabled && device.isSuccess ? (subscribed ? '켜짐' : '꺼짐') : null],
          // WP-913: 앱 전체 스위치를 꺼 둔 앱(로드된 값만).
          ['꺼 둔 앱', settings.data ? offApps(settings.data.apps) : null],
        ],
      }}
      data-testid="notification-settings-page"
    >
      {config.isSuccess && !enabled && (
        <SettingsSection
          data-testid="push-disabled-notice"
          title="푸시 알림을 사용할 수 없습니다"
          description="이 서버에서는 푸시 알림이 꺼져 있어요. 아래 설정은 앱 안 알림 목록에 적용돼요."
        />
      )}

      {enabled && (
        <SettingsSection title="이 기기" description="앱을 닫아도 이 기기로 알림을 받아요.">
          <SettingsToggleRow
            label="이 기기에서 푸시 받기"
            control={
              <BusySwitch
                data-testid="push-device-toggle"
                checked={subscribed}
                disabled={support === 'ios-needs-install' || support === 'unsupported'}
                busy={busy}
                onCheckedChange={onToggleDevice}
                aria-label="이 기기에서 푸시 받기"
              />
            }
          />
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
        </SettingsSection>
      )}

      <SettingsSection
        title="알림 종류"
        description="끄면 알림 목록·실시간 표시·푸시 모두 오지 않아요. 모든 기기에 똑같이 적용돼요."
      >
        {settings.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : settings.isError ? (
          <p className="text-sm text-destructive">알림 설정을 불러오지 못했어요.</p>
        ) : (
          <NotificationSettingsMatrix
            settings={settings.data}
            saving={updateSettings.isPending}
            // 모바일(1024px 미만)은 카드를 접고 펼치는 좁은 배치.
            compact={isMobile}
            // 바뀐 앱 스위치·칸 하나만 보낸다 — 서버가 전체를 돌려줘 캐시를 바꾼다.
            onAppChange={(app, v) => updateSettings.mutate({ apps: { [app]: v } })}
            onCellChange={(item, actor, v) => updateSettings.mutate({ cells: [{ item, actor, enabled: v }] })}
          />
        )}
      </SettingsSection>
    </SettingsPage>
  )
}

/** AI 화면 맥락용 — 앱 전체 스위치를 꺼 둔 앱 이름 목록(없으면 「없음」). 화면에 없는 모르는 앱은 맥락에서도 뺀다(knownApps). */
function offApps(apps: NotificationAppSetting[]): string {
  const off = knownApps(apps)
    .filter((a) => !a.enabled)
    .map((a) => APP_LABEL[a.app])
  return off.length > 0 ? off.join(', ') : '없음'
}
