// workplace-api 호출용 axios 인스턴스. AGENT API key 인증.
// addIssueComment 는 5c-1 에서 본문 구현. updateIssueStatus 는 5c-2 영역.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';

export interface WorkplaceApiClient {
  // 이슈에 코멘트 작성 — AGENT 권한 (Phase 5c-1).
  addIssueComment(issueKey: string, body: string): Promise<void>;
  // 이슈 상태 변경 — Phase 5c-2 에서 본문 구현 예정.
  updateIssueStatus(issueKey: string, statusKey: string): Promise<void>;
}

// issueKey("WP-42" / "A-B-7") → workplace-api URL 부품. projectKey 에
// 하이픈이 들어갈 수 있어 lastIndexOf 로 분리.
export function parseIssueKey(issueKey: string): {
  projectKey: string;
  number: number;
} {
  const idx = issueKey.lastIndexOf('-');
  return {
    projectKey: issueKey.slice(0, idx),
    number: Number(issueKey.slice(idx + 1)),
  };
}

const NOT_IMPL_UPDATE =
  'updateIssueStatus 는 5c-1 단계에서 미구현 — Phase 5c-2 에서 채움';

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  apiKey: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { 'X-Api-Key': opts.apiKey },
  });

  return {
    async addIssueComment(issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.post(`/projects/${projectKey}/issues/${number}/comments`, {
        body,
      });
    },
    async updateIssueStatus(_issueKey, _statusKey) {
      throw new Error(NOT_IMPL_UPDATE);
    },
  };
}
