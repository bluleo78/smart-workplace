// 설정 화면 섹션 id(WP-1298) — 화면 SettingsSection 의 id 와 가이드 섹션 id 가 같아야 가이드가 본문의 지금 섹션을 따라간다(WP-1281).
// 화면 컴포넌트와 가이드(settingsGuides.ts)가 같은 값을 쓰도록 한곳에 둔다 — 섹션 컴포넌트가 가이드 글 모듈 전체를 끌어오지 않고
// id 만 쓰게 한다. 가이드에 도움말이 있는 섹션만 둔다(도움말 없는 섹션은 따라갈 대상이 아니다).
// 값은 문서 전체에서 겹치지 않게 화면 이름을 앞에 붙인다 — 같은 화면에 여러 섹션이 함께 그려지고 document.getElementById 로 찾는다.
export const SETTINGS_SECTION_IDS = {
  // 설정 › 프로필
  profileInfo: 'profile-info',
  profilePassword: 'profile-password',
  // 설정 › AI 비서
  assistantPersonal: 'assistant-personal',
  assistantSuggestions: 'assistant-suggestions',
  assistantMemory: 'assistant-memory',
  // 설정 › 알림
  notificationDevice: 'notification-device',
  notificationTypes: 'notification-types',
  // 설정 › SSO
  ssoLogin: 'sso-login',
  // 설정 › 앱 설정 › 작업 관리
  relationTypes: 'work-app-relation-types',
  // 설정 › 역할 상세
  rolePermissions: 'role-permissions',
  // 설정 › 사용자 상세
  userActive: 'user-active',
  userRoles: 'user-roles',
  // 프로젝트 설정(팀·개인 같은 id — 개인 프로젝트의 「AI 어시스턴트」 섹션도 멤버 섹션 id 를 쓴다)
  projectMembers: 'project-members',
  projectLabels: 'project-labels',
  projectIssueTypes: 'project-issue-types',
  projectFields: 'project-fields',
  projectDanger: 'project-danger',
} as const
