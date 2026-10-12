// src/index.ts — 패키지 공개 API. 앱이 쓰는 것만 내보낸다(도구 내부 헬퍼·스키마는 각 모듈이 직접 import).
export { parseIssueKey, describeApiError } from './parse.js';
export type { McpTool, McpToolAnnotations, SharedTool, ToolHints, ToolKind } from './mcp-tool.js';
export { TOOL_APPS, TOOL_APP_GUIDES, isToolApp, toolApps, type ToolApp, type ToolAppGuide, type ToolAppTag } from './tool-apps.js';
export { toolAnnotations } from './tool-annotations.js';
export { toMcpContent, summarizeToolResult, resultText, replaceImagesWithNotice, type McpContent, type McpToolResult } from './mcp-content.js';
export { issueListFilterShape } from './schemas.js';
export {
  READ_ATTACHMENT_DEFAULT_LIMIT,
  readRangeShape,
  resolveRange,
  SENDABLE_IMAGE_MIMES,
  IMAGE_MAX_BYTES,
  baseMimeType,
  imageRejectReasons,
  isSendableImage,
  toBase64,
} from './attachment-read.js';
export type * from './tool-client.js';
export {
  listConflicts,
  normalizeTimezone,
  NO_ATTENDEE_TO_ADD,
  resolveAttendees,
  resolveAttendeeToRemove,
  type EventConflict,
  type ResolvedAttendees,
} from './calendar-tools.js';
export { findMemberByUsername, requireActiveMember, requireMember, type RequiredMember } from './member-tools.js';
// WP-349: 확인 카드(propose_create_project·add_project_member·add_channel_member)가 직접 실행 도구와 같은 입력 스키마·본문 변환을 쓴다.
export { addProjectMemberInput, createProjectInput, toCreateProjectBody } from './project-tools.js';
export { addChannelMemberInput } from './messaging-tools.js';
export { buildSharedTools, type SharedToolClient, type SharedToolOptions } from './shared-tools.js';
export { createSharedToolClient, type HttpLike, type HttpRequestConfig } from './rest-client.js';
export { TOOL_LABELS, isDisplayableTool, stripMcpPrefix, type ToolLabel } from './tool-labels.js';
export { TOOL_NAME_MAX_LENGTH, toolNameViolations } from './tool-naming.js';
