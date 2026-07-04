// apps/workplace-web/src/pages/settings/MailSettingsPage.tsx
// 설정 > 개인 > 메일 계정 — 개인 IMAP/SMTP 계정 추가/수정/삭제.
import { SettingsPage } from '@/components/layout/SettingsPage'
import { MailAccountsSection } from '@/pages/profile/MailAccountsSection'

export default function MailSettingsPage() {
  return (
    <SettingsPage title="메일 계정" width="form">
      <MailAccountsSection />
    </SettingsPage>
  )
}
