// apps/workplace-web/src/pages/settings/MailSettingsPage.tsx
// 설정 > 개인 > 메일 계정 — 개인 IMAP/SMTP 계정 추가/수정/삭제.
// 제목은 MailAccountsSection 의 CardTitle 이 담당(중복 방지).
import { MailAccountsSection } from '@/pages/profile/MailAccountsSection'

export default function MailSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <MailAccountsSection />
    </div>
  )
}
