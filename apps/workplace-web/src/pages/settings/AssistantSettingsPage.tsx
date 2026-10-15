// apps/workplace-web/src/pages/settings/AssistantSettingsPage.tsx
// 설정 > 개인 > AI 비서 — 추천 질문 켜기/끄기(WP-139, 맨 위) + 메모리(WP-55) + 개인 Claude OAuth 토큰/모델/생각 깊이.
import { SettingsPage } from '@/components/layout/SettingsPage'
import { settingsGuides } from '@/components/settings-guide/settingsGuides'
import { PersonalAssistantSection } from '@/pages/profile/PersonalAssistantSection'
import { AiMemoryCard } from '@/pages/settings/AiMemoryCard'
import { SuggestionPreferenceCard } from '@/pages/settings/SuggestionPreferenceCard'

export default function AssistantSettingsPage() {
  return (
    <SettingsPage title="AI 비서" width="form" guide={settingsGuides.assistant}>
      <SuggestionPreferenceCard />
      <AiMemoryCard />
      <PersonalAssistantSection />
    </SettingsPage>
  )
}
