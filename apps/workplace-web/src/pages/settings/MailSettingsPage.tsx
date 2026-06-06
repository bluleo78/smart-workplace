// apps/workplace-web/src/pages/settings/MailSettingsPage.tsx
// 설정 > 개인 > 메일 계정 — 개인 IMAP/SMTP 계정 추가/수정/삭제.
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { MailAccountsSection } from '@/pages/profile/MailAccountsSection'

export default function MailSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className={pageTitleClass}>메일 설정</h1>
      <MailAccountsSection />
    </div>
  )
}
