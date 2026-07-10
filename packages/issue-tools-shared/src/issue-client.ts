// src/issue-client.ts — 공유 이슈 도구가 호출하는 구조적 클라이언트 인터페이스.
// issueKey(string) 기준. mcp(PatApiClient)/ai-agent(WorkplaceApiClient) 어댑터가 이 시그니처를 만족시킨다.
import type { ProjectMetaClient } from './resolve.js';

export interface IssueToolClient extends ProjectMetaClient {
  /** 이슈 상세 — 백엔드 raw JSON 반환(정규화는 도구 핸들러가 normalizeIssueDetail 로 수행). */
  getIssueDetail(issueKey: string): Promise<unknown>;
  /** 이슈 생성 — 생성 응답 raw 반환. */
  createIssue(projectKey: string, body: Record<string, unknown>): Promise<unknown>;
  /** 내용/상태/우선순위/날짜 PATCH. */
  updateIssueContent(issueKey: string, body: Record<string, unknown>): Promise<unknown>;
  setIssueType(issueKey: string, typeId: number): Promise<unknown>;
  setIssueParent(issueKey: string, parentNumber: number | null): Promise<unknown>;
  replaceIssueAssignees(issueKey: string, assigneeIds: number[]): Promise<unknown>;
  replaceIssueLabels(issueKey: string, labelIds: number[]): Promise<unknown>;
  addComment(issueKey: string, body: string): Promise<void>;
  editComment(issueKey: string, commentId: number, body: string): Promise<void>;
  /** 갱신된 상세 raw 반환. */
  addIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<unknown>;
  removeIssueDependency(issueKey: string, otherNumber: number, direction: 'blocks' | 'blockedBy'): Promise<void>;
}
