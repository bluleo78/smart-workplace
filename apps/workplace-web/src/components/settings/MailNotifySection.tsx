// src/components/settings/MailNotifySection.tsx
// 설정 > 알림 > 「메일」 절 — 메일 계정마다 새 메일 알림 범위(모든 새 메일 / 업무 메일만 / 끔)를 고른다(WP-1740).
// 계정이 없거나 목록을 못 불러오면 절 자체를 그리지 않는다. 이 기기 푸시가 꺼져 있으면 켜기 안내를 맨 위에 둔다.
import { useMutationState } from '@tanstack/react-query'

import { SettingsSection } from '@/components/layout/SettingsSection'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { setMailNotifyModeKey, useMailAccounts, useSetMailNotifyMode } from '@/hooks/queries/useMailAccounts'
import { MAIL_NOTIFY_MODE_LABEL, type MailNotifyMode } from '@/types/mailAccount'

/** 라디오 항목 순서 — 문구는 MAIL_NOTIFY_MODE_LABEL 하나를 쓴다. */
const OPTIONS: MailNotifyMode[] = ['ALL', 'WORK', 'OFF']

interface Props {
  /** 이 기기 푸시 구독 여부 — false 일 때만 켜기 안내를 보인다. 조회 중(알 수 없음)이면 undefined 라 안내를 숨긴다. */
  subscribed: boolean | undefined
  /** 안내의 「켜기」 — 페이지의 기기 푸시 켜기 핸들러. */
  onEnableDevice: () => void
  /** 켜기를 누를 수 없는 상태(처리 중·iOS 미설치·미지원). */
  enableDisabled: boolean
}

export function MailNotifySection({ subscribed, onEnableDevice, enableDisabled }: Props) {
  const accounts = useMailAccounts()
  const setMode = useSetMailNotifyMode()

  // 저장 중인 계정 id 들 — 뮤테이션 하나의 마지막 호출이 아니라 진행 중인 전부를 본다(겹친 요청 방지).
  const savingIds = useMutationState({
    filters: { mutationKey: setMailNotifyModeKey, status: 'pending' },
    select: (m) => (m.state.variables as { id: number }).id,
  })

  if (!accounts.data || accounts.data.length === 0) return null

  return (
    <SettingsSection
      data-help="notifications.mail"
      data-testid="mail-notify-section"
      title="메일"
      description="새 메일이 오면 이 기기에 알림을 띄워요. 계정마다 따로 정해요."
    >
      {subscribed === false && (
        <p data-testid="mail-notify-push-off" className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3 text-sm">
          이 기기에서 푸시 받기를 켜야 메일 알림이 와요.
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="mail-notify-enable-push"
            disabled={enableDisabled}
            onClick={onEnableDevice}
          >
            켜기
          </Button>
        </p>
      )}
      <div className="divide-y">
        {accounts.data.map((a) => {
          // 그 계정을 저장하는 동안만 그 계정 라디오를 잠근다 — 다른 계정은 계속 고를 수 있다.
          const saving = savingIds.includes(a.id)
          return (
            <div key={a.id} data-testid={`mail-notify-row-${a.id}`} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className="text-sm font-medium">{a.emailAddress}</span>
                <RadioGroup
                  aria-label={`${a.emailAddress} 메일 알림 범위`}
                  className="flex flex-wrap gap-x-4 gap-y-2"
                  value={a.notifyMode}
                  onValueChange={(v) => setMode.mutate({ id: a.id, notifyMode: v as MailNotifyMode })}
                >
                  {OPTIONS.map((o) => (
                    <div key={o} className="flex items-center gap-2">
                      <RadioGroupItem
                        id={`mail-notify-${a.id}-${o}`}
                        data-testid={`mail-notify-${a.id}-${o}`}
                        value={o}
                        disabled={saving}
                      />
                      <Label htmlFor={`mail-notify-${a.id}-${o}`} className="text-sm font-normal">
                        {MAIL_NOTIFY_MODE_LABEL[o]}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
              {/* AI 분류가 꺼진 계정은 업무 메일을 가릴 수 없어 서버가 모든 새 메일로 알린다. */}
              {a.notifyMode === 'WORK' && !a.aiEnabled && (
                <p data-testid={`mail-notify-ai-off-${a.id}`} className="mt-2 text-xs text-muted-foreground">
                  AI 분류가 꺼져 있어 모든 새 메일로 알려요.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </SettingsSection>
  )
}
