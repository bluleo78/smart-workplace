// apps/workplace-web/src/pages/settings/MailSettingsPage.tsx
// 설정 > 개인 > 메일 계정 — 개인 IMAP/SMTP 계정 추가/수정/삭제.
// 리스트/스캔 목적 화면이라 풀폭(#674) — TokenSettingsPage(#655)를 참조 구현으로 삼는다.
// 추가/수정 다이얼로그는 여기서 소유해 "계정 추가" 버튼을 헤더 actions 에 올린다.
import { useState } from 'react'

import { SettingsPage } from '@/components/layout/SettingsPage'
import { Button } from '@/components/ui/button'
import { useMailAccounts } from '@/hooks/queries/useMailAccounts'
import { MailAccountDialog } from '@/pages/profile/components/MailAccountDialog'
import { MailAccountsSection } from '@/pages/profile/MailAccountsSection'
import type { MailAccountResponse } from '@/types/mailAccount'

export default function MailSettingsPage() {
  const { data: accounts } = useMailAccounts()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<MailAccountResponse | null>(null)

  const globalAiEnabled = accounts?.some((a) => a.aiEnabled) ?? false

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (acc: MailAccountResponse) => {
    setEditing(acc)
    setDialogOpen(true)
  }

  return (
    <SettingsPage
      title="메일 계정"
      width="full"
      actions={
        <Button onClick={openAdd} data-testid="mail-add-trigger">
          계정 추가
        </Button>
      }
    >
      <MailAccountsSection onEdit={openEdit} />
      <MailAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editing}
        defaultAiEnabled={globalAiEnabled}
      />
    </SettingsPage>
  )
}
