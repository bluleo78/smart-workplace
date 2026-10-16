// src/index.ts — 패키지 공개 API. 앱이 쓰는 것만 내보낸다(도구 내부 헬퍼·스키마는 각 모듈이 직접 import).
export { parseIssueKey, describeApiError } from './parse.js';
export type { McpTool, McpToolAnnotations, SharedTool, ToolHints, ToolKind } from './mcp-tool.js';
export { TOOL_APPS, TOOL_APP_GUIDES, isToolApp, toolApps, type ToolApp, type ToolAppGuide, type ToolAppTag } from './tool-apps.js';
export { toolAnnotations } from './tool-annotations.js';
// WP-340 웨이브 5: tools/list 로 내보내는 도구 정의(workplace-mcp)와 그 크기 근사(상한 테스트·보고).
export {
  estimateTokens,
  nullAsOmitted,
  toolDefinition,
  toolDefinitionsSize,
  wireInputSchema,
  type ToolDefinition,
  type ToolDefinitionSize,
} from './tool-definitions.js';
export { toMcpContent, summarizeToolResult, resultText, replaceImagesWithNotice, type McpContent, type McpToolResult } from './mcp-content.js';
export { issueListFilterShape } from './schemas.js';
export {
  READ_ATTACHMENT_DEFAULT_LIMIT,
  readRangeShape,
  resolveRange,
  SENDABLE_IMAGE_MIMES,
  IMAGE_MAX_BYTES,
  baseMimeType,
  isSendableImage,
  toBase64,
} from './attachment-read.js';
// WP-250: 모델 입력용 이미지(/view) — ai-agent 가 자기 첨부 도구에서 같은 헬퍼를 쓴다.
export {
  canViewPages,
  MAX_PAGES_PER_CALL,
  PAGES_DESCRIPTION,
  imageViewBlocks,
  pageBlocks,
  withPages,
} from './attachment-view.js';
export { isImageSkip, pdfNote } from './attachment-tools.js';
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
// WP-352·353: ai-agent 의 메시징 prefetch 가 이벤트 본문·최근 메시지의 `<@id>` 토큰을 도구 출력과 같은 `@이름(username)` 으로 푼다.
export { addChannelMemberInput, resolveMentionTokens } from './messaging-tools.js';
// WP-369: AI Chat 의 create_drive_file 판이 업로드 링크 안내를 뺀 content 모드 설명만 쓴다(ai-agent mcp/tools.ts).
export { CREATE_DRIVE_FILE_CONTENT_DESCRIPTION } from './drive-tools.js';
export { buildSharedTools, type SharedToolClient, type SharedToolOptions } from './shared-tools.js';
export { createSharedToolClient, decodeErrorBody, getBytes, type HttpLike, type HttpRequestConfig, viewUrl } from './rest-client.js';
export { MEMORY_TOOL_NAMES, TOOL_LABELS, isDisplayableTool, isMemoryTool, stripMcpPrefix, type ToolLabel } from './tool-labels.js';
export { AGENT_TOOL_NAME_MAX_LENGTH, SHARED_TOOL_NAME_MAX_LENGTH, toolNameViolations } from './tool-naming.js';
