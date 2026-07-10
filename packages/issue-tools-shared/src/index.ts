// src/index.ts — 패키지 공개 API.
export { resolveTypeId, resolveAssigneeIds, resolveLabelIds } from './resolve.js';
export type { ProjectMetaClient } from './resolve.js';
export { parseIssueKey, errText } from './parse.js';
export type { McpTool } from './mcp-tool.js';
export {
  issueKeyInput,
  createIssueInput,
  updateIssueInput,
  addCommentInput,
  editCommentInput,
  dependencyInput,
} from './schemas.js';
export { normalizeIssueDetail, issueDetail, type IssueDetail } from './issue-detail.js';
export { buildSharedIssueTools } from './issue-tools.js';
export type { IssueToolClient } from './issue-client.js';
