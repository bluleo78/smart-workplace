// apps/workplace-web/src/pages/settings/AssistantSettingsPage.tsx
// 설정 > 개인 > AI 비서 — 개인 Claude OAuth 토큰/모델/생각 깊이.
// 제목은 PersonalAssistantSection 의 CardTitle("개인 비서")이 담당(중복 방지).
import { PersonalAssistantSection } from '@/pages/profile/PersonalAssistantSection'

export default function AssistantSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <PersonalAssistantSection />
    </div>
  )
}
