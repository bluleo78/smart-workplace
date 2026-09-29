// WP-48 설정 › 워크스페이스 관리 › SSO — "SSO 로그인 사용" 토글과 관리자 동의 링크.
import { useState } from 'react'
import { toast } from 'sonner'

import { SettingsPage } from '@/components/layout/SettingsPage'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSetSsoEnabled, useSsoSettings } from '@/hooks/queries/useSsoSettings'
import { extractApiError } from '@/lib/api-error'

export default function SsoSettingsPage() {
  const { data } = useSsoSettings()
  const setEnabled = useSetSsoEnabled()
  // 끄기 확인 다이얼로그 — SSO 전용 구성원이 있을 때만.
  const [confirmOff, setConfirmOff] = useState(false)

  const apply = (enabled: boolean) =>
    setEnabled.mutate(enabled, {
      onSuccess: () => toast.success(enabled ? 'SSO 로그인을 켰습니다.' : 'SSO 로그인을 껐습니다.'),
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
    <SettingsPage title="SSO" width="form">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle id="sso-toggle-label">SSO 로그인 사용</CardTitle>
            <CardDescription>
              켜면 구성원이 Microsoft 계정으로 로그인할 수 있고, 비밀번호 없는 "SSO 전용" 구성원을 등록할 수 있습니다.
            </CardDescription>
          </div>
          <Switch
            aria-labelledby="sso-toggle-label"
            checked={data?.enabled ?? false}
            disabled={!data?.available || setEnabled.isPending}
            onCheckedChange={onToggle}
          />
        </CardHeader>
        {data && !data.available && (
          <CardContent>
            <p className="text-sm text-muted-foreground">SSO 를 사용하려면 운영자 설정이 필요합니다.</p>
          </CardContent>
        )}
      </Card>

      {data?.adminConsentUrl && (
        <Card>
          <CardHeader>
            <CardTitle>관리자 동의 링크</CardTitle>
            <CardDescription>
              회사 Entra(Microsoft 365) 관리자에게 전달해 한 번 승인받으세요. 승인 전에는 구성원이 "관리자 승인 필요" 오류로 로그인하지 못할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input readOnly value={data.adminConsentUrl} className="text-xs" aria-label="관리자 동의 링크" />
            <Button type="button" variant="outline" onClick={copyConsent}>복사</Button>
          </CardContent>
        </Card>
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
