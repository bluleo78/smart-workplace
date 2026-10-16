// WP-48 설정 › 워크스페이스 관리 › SSO — "SSO 로그인 사용" 토글과 관리자 동의 링크.
import { useState } from 'react'
import { toast } from 'sonner'

import { SettingsPage } from '@/components/layout/SettingsPage'
import { SettingsSection, SettingsToggleRow } from '@/components/layout/SettingsSection'
import { settingsGuides } from '@/components/settings-guide/settingsGuides'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSetSsoEnabled, useSsoSettings } from '@/hooks/queries/useSsoSettings'
import { extractApiError } from '@/lib/api-error'

export default function SsoSettingsPage() {
  const { data } = useSsoSettings()
  const setEnabled = useSetSsoEnabled()
  // 끄기 확인 다이얼로그 — SSO 전용 구성원이 있을 때만.
  const [confirmOff, setConfirmOff] = useState(false)

  // 즉시 적용 토글 — 성공 토스트는 띄우지 않는다. 스위치 상태 자체가 피드백이고, 우상단 토스트가 오른쪽 끝 토글을 가린다.
  const apply = (enabled: boolean) =>
    setEnabled.mutate(enabled, {
      onError: (e) => toast.error(extractApiError(e, 'SSO 설정 변경에 실패했습니다.')),
    })

  const onToggle = (next: boolean) => {
    if (!next && (data?.passwordlessMemberCount ?? 0) > 0) {
      setConfirmOff(true)
      return
    }
    apply(next)
  }

  const copyConsent = async () => {
    if (!data?.adminConsentUrl) return
    await navigator.clipboard.writeText(data.adminConsentUrl)
    toast.success('링크를 복사했습니다.')
  }

  return (
    <SettingsPage
      title="SSO"
      width="form"
      guide={settingsGuides.sso}
      // WP-414: AI 화면 맥락 — 사용 여부만(관리자 동의 링크 등 다른 값은 싣지 않는다). 로드 전엔 보내지 않는다.
      aiContext={data ? { facts: [['SSO 로그인', data.enabled ? '켜짐' : '꺼짐']] } : null}
    >
      <SettingsSection
        title="SSO 로그인"
        description='켜면 구성원이 Microsoft 계정으로 로그인할 수 있고, 비밀번호 없는 "SSO 전용" 구성원을 등록할 수 있어요.'
      >
        {/* 행 라벨은 섹션 제목과 겹치지 않게 "…사용" 으로 두고, 스위치 접근 이름(aria-labelledby)으로도 쓴다. */}
        <SettingsToggleRow
          label={<span id="sso-toggle-label">SSO 로그인 사용</span>}
          control={
            // 운영자 env 가 사라져(available=false) 켤 수는 없어도, 이미 켜져 있으면 끌 수는 있어야 한다.
            <Switch
              aria-labelledby="sso-toggle-label"
              checked={data?.enabled ?? false}
              disabled={(!data?.available && !data?.enabled) || setEnabled.isPending}
              onCheckedChange={onToggle}
            />
          }
        />
        {data && !data.available && (
          <p className="text-sm text-muted-foreground">SSO 를 사용하려면 운영자 설정이 필요합니다.</p>
        )}
      </SettingsSection>

      {data?.adminConsentUrl && (
        <SettingsSection
          title="관리자 동의 링크"
          description='회사 Entra(Microsoft 365) 관리자에게 전달해 한 번 승인받으세요. 승인 전에는 구성원이 "관리자 승인 필요" 오류로 로그인하지 못할 수 있어요.'
        >
          <div className="flex gap-2">
            <Input readOnly value={data.adminConsentUrl} className="text-xs" aria-label="관리자 동의 링크" />
            <Button type="button" variant="outline" onClick={copyConsent}>복사</Button>
          </div>
        </SettingsSection>
      )}

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>SSO 로그인을 끌까요?</AlertDialogTitle>
            <AlertDialogDescription>
              비밀번호가 없는 SSO 전용 구성원 {data?.passwordlessMemberCount}명이 로그인할 수 없게 됩니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={() => apply(false)}>끄기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  )
}
