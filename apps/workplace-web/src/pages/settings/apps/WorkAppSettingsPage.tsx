// 설정 › 앱 설정 › 작업 관리(WP-887) — 모든 프로젝트에 공통으로 쓰이는 작업 관리 설정(워크스페이스 관리자).
// 지금은 「이슈 관계 유형」 한 묶음. 설정이 둘 이상이 되면 묶음을 탭으로 나눈다(시안 A).
import { SettingsPage } from '@/components/layout/SettingsPage'
import { settingsGuides } from '@/components/settings-guide/settingsGuides'

import { IssueRelationTypesSection } from './IssueRelationTypesSection'

export default function WorkAppSettingsPage() {
  return (
    <SettingsPage title="작업 관리" width="form" guide={settingsGuides.workApp} data-testid="work-app-settings-page">
      <IssueRelationTypesSection />
    </SettingsPage>
  )
}
