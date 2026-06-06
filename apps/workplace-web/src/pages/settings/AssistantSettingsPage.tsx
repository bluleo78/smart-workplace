// apps/workplace-web/src/pages/settings/AssistantSettingsPage.tsx
// 설정 > 개인 > AI 비서 — 개인 Claude OAuth 토큰/모델/생각 깊이.
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { PersonalAssistantSection } from '@/pages/profile/PersonalAssistantSection'

export default function AssistantSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className={pageTitleClass}>비서 설정</h1>
      <PersonalAssistantSection />
    </div>
  )
}
