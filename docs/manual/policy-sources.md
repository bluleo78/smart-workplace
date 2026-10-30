# 정책 서술 근거

매뉴얼 본문에서 `TODO(정책)` 을 채운 문장마다 근거가 된 소스 위치를 적는다(2026-10-30, WP-1197). 화면이나 동작이 바뀌면 이 표의 위치부터 다시 확인한다. 경로는 저장소 루트 기준이고, `api/` 는 `apps/workplace-api/src/main/java/com/workplace/`, `web/` 는 `apps/workplace-web/src/`, `admin/` 은 `apps/workplace-admin/src/`, `agent/` 는 `apps/workplace-ai-agent/src/` 를 줄인 것이다.

## 사용자 매뉴얼

| 장 | 서술 | 근거 |
| --- | --- | --- |
| 01 | 워크스페이스 소유자 = 관리자(ADMIN 역할), 소유자 전용 기능 없음 | `api/platform/service/PlatformTenantService.java:302,329-330`(OWNER → ADMIN 역할), 테넌트 쪽 검사는 RBAC 권한만 씀 |
| 02·18 | 5번 연달아 틀리면 잠김, 마지막 실패부터 15분 | `api/auth/service/LoginAttemptService.java:17`, `api/auth/repository/LoginAttemptRepository.java:24-27` |
| 02·18 | 잠김 문구 「로그인 시도 횟수를 초과하였습니다…」 | `api/auth/service/PasswordLoginVerifier.java:55-56`, `web/pages/LoginPage.tsx:65-66` |
| 02·18 | 비밀번호 재설정 화면·API 없음, 관리자도 남의 비밀번호를 못 바꿈 | `web/pages/LoginPage.tsx:84-144`, `api/user/controller/UserController.java:68`(본인 `PUT /me/password` 만) |
| 02·18 | 비활성 구성원은 그 워크스페이스가 목록에서 빠짐, 남은 곳이 없으면 「접속 가능한 워크스페이스가 없습니다…」 | `api/user/service/UserService.java:778-790`, `web/hooks/AuthContext.tsx:177`, `web/lib/activeTenant.ts:69` |
| 03 | AI 우선순위 15분 배치, AI 비서가 없으면 건너뜀 | `api/home/service/PriorityClassificationScheduler.java:112,175-181` |
| 04 | AI 어시스턴트 앱별 바로 실행·확인 카드 | `agent/agent/subagents/*/agent.md` 도구 목록, `agent/mcp/tools.ts:54-60,445-450`(카드 전용 도구) |
| 05 | 에이전트 DM·멘션 응답 규칙, 답글만 직접·이슈/일정은 카드 | `api/messaging/service/MessageService.java:170-246`, `agent/agent/run-messaging-agent.ts:20-55`, `agent/mcp/tools.ts:585-697` |
| 07 | 일정 삭제는 참석자에게서도 사라지고 취소 알림 | `api/calendar/service/CalendarEventService.java:1062-1081` |
| 07 | 반복 일정 삭제 범위 3가지 | `web/components/calendar/RecurrenceScopeDialog.tsx:26-66`, `CalendarEventService.java:1093-1130` |
| 07 | 「모든 일정 삭제」 는 로컬 캘린더만, 영구 삭제·알림 없음 | `web/components/calendar/CalendarSidebar.tsx:181-194`, `web/pages/calendar/CalendarPage.tsx:774-776`, `api/calendar/service/CalendarService.java:97-109` |
| 07·12 | 외부 캘린더는 Outlook(M365) 메일 계정 연결로만, IMAP 은 캘린더 없음 | `api/calendar/.../CalendarAccountSyncDispatcher.java`, `CalendarSyncService.java:20,58` |
| 08 | 프로젝트 역할 소유자·멤버, 관리자 우회(팀 프로젝트만), 삭제 확인 문구 | `web/.../MemberManagement.tsx:263-264`, `api/.../ProjectAccessGuard.java:14-15,186-188`, `api/.../ProjectService.java:220,270`, `web/components/settings-guide/settingsGuides.ts:108-119`, `web/pages/projects/ProjectSettingsPage.tsx:228-255` |
| 09 | 공유 링크는 편집자 이상, 드라이브 외부 공유 차단 설정 없음 | `api/drive/service/DriveShareLinkService.java:58`, 설정은 노트(`web/pages/admin/WikiSharingPage.tsx:65-69`)에만 있음 |
| 09 | 공간 역할(쓰기 = 편집자, 읽기 = 보기 전용, 공간 관리 = 소유자) | `api/drive/service/DrivePermissions.java:16`, `DriveFileService`·`DriveFolderService`(EDITOR/VIEWER), `DriveSpaceService.java:107-181`(OWNER) |
| 09 | 팀 공간 삭제는 휴지통 없이 영구 삭제 | `api/drive/service/DriveSpaceService.java:173-197`, `web/components/drive/DriveSidebar.tsx:388-391` |
| 10 | 페이지 삭제 시 하위 페이지 함께, 되살릴 수 없음 | `web/components/wiki/WikiDeletePageDialog.tsx:35-38`, `apps/workplace-api/src/main/resources/db/migration/V67__init_wiki.sql:36`, `web/components/wiki/WikiDeleteSpaceDialog.tsx:14` |
| 10 | 스페이스 역할, 부서는 편집자·보기 전용만 | `web/lib/spaceRoles.ts:20,37`, `api/wiki/service/WikiSpaceService.java:118-221`, `api/wiki/service/WikiShareService.java:549` |
| 10 | AI 초안·AI 작성은 확인 없이 본문에 바로 들어감 | `web/components/wiki/WikiEditor.tsx:404-478,554-575` |
| 11 | 공유 외부 연락처는 만든 사람·관리자만 수정·삭제 | `api/contact/service/ContactService.java:98-101,124,182,232-236`, `web/.../ContactDetailPanel.tsx:150` |
| 12 | Outlook(M365) 연결 흐름과 문구 | `web/pages/profile/components/MailAccountDialog.tsx:89-92,317-347`, `api/.../M365OAuthController.java:79-106` |
| 12 | 공통 비서 대체 순서, 공용 메모리 권한 | `api/auth/service/AssistantResolver.java:30-49`, `api/home/service/SharedMemorySpaces.java:25-33,72-83,135-176` |
| 12 | 토큰 = 본인 권한, 웹 세션 전용 작업 제외, 유효기간 선택지, 20개 상한, 발급 차단 설정 없음 | `web/pages/settings/components/TokenIssueFormDialog.tsx:31-35,107`, `api/global/security/RequireWebSession.java`, `api/auth/service/UserApiTokenService.java:39` |
| 12 | AI 어시스턴트에 설정 변경 도구 없음 | `agent/mcp/tools.ts`(설정 도구 없음, 메모리 도구만 `:373-375`) |
| 14 | SSO 전용 구성원 추가(로그인 방식 라디오) | `web/components/users/AddMemberDialog.tsx:45,82,139-153,205-222` |
| 14 | 할당된 역할은 삭제 불가 | `api/role/service/RoleService.java:94-105` |
| 15 | 공통 비서 해제 → 개인 비서 없는 사람은 AI 끔 | `api/auth/service/WorkspaceAssistantService.java:110-112`, `api/user/service/UserService.java:166,176`, `web/components/layout/AppLayout.tsx:75-119` |
| 15 | 에이전트 삭제: 기록 없으면 삭제, 있으면 사용 중지 | `api/auth/service/AgentRemovalService.java`, `web/pages/admin/AgentManagementPage.tsx:116-122`, `web/hooks/queries/useAgents.ts:64-71`, `.../migration/V9__multi_assignee.sql:5-10` |
| 17 | 감사 로그 삭제·내보내기 없음(보관 기간 설정 없음 → 운영자 문의) | `api/audit/controller/AuditLogController.java:31`(조회만), `web/pages/admin/AuditLogListPage.tsx` |
| 17 | 에이전트 행동도 기록, 사용자 열에 에이전트 아이디 | `.../migration/V196__agent_delete_user_fk_actions.sql:1-2`, `web/pages/admin/AuditLogListPage.tsx:395` |

## 운영자 매뉴얼

| 장 | 서술 | 근거 |
| --- | --- | --- |
| 01 | 슈퍼어드민 추가 방법 없음(첫 가입자만) | `admin/pages/OperatorsPage.tsx:4`, `api/auth/service/AuthService.java:128-130` |
| 02 | 드라이브 한도 기본값 10GB, 테넌트마다 변경 | `apps/workplace-api/src/main/resources/application.yml:85`, `admin/pages/TenantDetailPage.tsx:479-492` |
| 03 | 첫 로그인 비밀번호 변경 강제 없음 | `api/platform/service/PlatformTenantService.java:323`, `admin/components/NewTenantMemberForm.tsx:96` |
| 04 | 정지에 사유 칸·소유자 알림 없음 | `api/platform/service/PlatformTenantService.java:212-214`, `admin/pages/TenantDetailPage.tsx:91` |
| 04 | 삭제한 테넌트 자동 영구 삭제 없음 | `api/platform/purge/TenantPurgeJob.java:33-41` |

## 남긴 TODO(정책) — 사람이 정할 운영 정책

- 운영자 01: 슈퍼어드민을 둘 이상 둘지와 절차
- 운영자 02: 테넌트별 드라이브 한도를 정하는 기준
- 운영자 04: 정지를 소유자에게 알리는 방법과 사유 기록 위치
- 운영자 04: 삭제한 테넌트의 보관 기간
