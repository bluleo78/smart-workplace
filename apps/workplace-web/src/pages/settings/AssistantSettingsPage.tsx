// apps/workplace-web/src/pages/settings/AssistantSettingsPage.tsx
// 설정 > 개인 > AI 비서 — 개인 Claude OAuth 토큰/모델/생각 깊이.
import { SettingsPage } from '@/components/layout/SettingsPage'
import { PersonalAssistantSection } from '@/pages/profile/PersonalAssistantSection'

export default function AssistantSettingsPage() {
  return (
    <SettingsPage title="AI 비서" width="form">
      <PersonalAssistantSection />
    </SettingsPage>
  )
}
