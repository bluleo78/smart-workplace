// src/shared-tools.ts — 두 앱이 노출하는 공유 도구 전체를 한 번에 구성한다(#846).
// workplace-mcp 는 전부 노출하고, ai-agent 는 프로필별로 이름을 골라 쓴다. 어느 쪽도 같은 이름의 도구를 따로 정의하지 않는다
// (각 앱의 패리티 테스트가 이를 강제) — 정의가 두 벌이면 파라미터 이름·기본값이 조용히 어긋난다.
import { buildCalendarTools } from './calendar-tools.js';
import { buildDriveTools } from './drive-tools.js';
import type { IssueToolClient } from './tool-client.js';
import { buildSharedIssueTools } from './issue-tools.js';
import { buildMailTools } from './mail-tools.js';
import type { McpTool } from './mcp-tool.js';
import { buildMemberTools } from './member-tools.js';
import { buildMessagingTools, type MessagingToolOptions } from './messaging-tools.js';
import { buildNotifyTools } from './notify-tools.js';
import { buildProjectTools } from './project-tools.js';
import type {
  CalendarToolClient,
  DriveToolClient,
  MailToolClient,
  MemberToolClient,
  MessagingToolClient,
  NotificationToolClient,
  ProjectToolClient,
  WikiToolClient,
} from './tool-client.js';
import { buildWikiTools } from './wiki-tools.js';

/** 공유 도구 전체가 요구하는 클라이언트 — 각 앱이 자기 API 클라이언트를 이 모양으로 어댑팅한다. */
export type SharedToolClient = IssueToolClient &
  ProjectToolClient &
  WikiToolClient &
  CalendarToolClient &
  MailToolClient &
  MemberToolClient &
  MessagingToolClient &
  DriveToolClient &
  NotificationToolClient;

export type SharedToolOptions = MessagingToolOptions;

/** 공유 도구 전체(이슈·프로젝트·노트·캘린더·메일·구성원/연락처·메시징·드라이브·알림). 이름 목록은 스냅샷 테스트가 고정한다. */
export function buildSharedTools(client: SharedToolClient, opts: SharedToolOptions = {}): McpTool[] {
  return [
    ...buildSharedIssueTools(client),
    ...buildProjectTools(client),
    ...buildWikiTools(client),
    ...buildCalendarTools(client),
    ...buildMailTools(client),
    ...buildMemberTools(client),
    ...buildMessagingTools(client, opts),
    ...buildDriveTools(client),
    ...buildNotifyTools(client),
  ];
}
