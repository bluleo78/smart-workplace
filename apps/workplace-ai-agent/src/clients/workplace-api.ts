// workplace-api 호출 client — INTERNAL_SERVICE_TOKEN 인증 + X-On-Behalf-Of 헤더 (#34).
// 매 메서드의 첫 인자 agentId 는 workplace-api 가 SecurityContext 의 principal 로 설정할
// AGENT user id. 누락 시 TypeScript 가 빌드 차단.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import { IssueDetail, issueDetail } from '../types/workplace-api.js';

export interface WorkplaceApiClient {
  addIssueComment(agentId: number, issueKey: string, body: string): Promise<void>;
  updateIssueStatus(agentId: number, issueKey: string, statusKey: string): Promise<void>;
  getIssueDetail(agentId: number, issueKey: string): Promise<IssueDetail>;
  unassignSelf(agentId: number, issueKey: string): Promise<void>;
  getOAuthToken(agentId: number): Promise<{ token: string; label: string | null }>;
}

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

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  internalToken: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { Authorization: `Internal ${opts.internalToken}` },
  });

  const onBehalfOf = (agentId: number) => ({
    headers: { 'X-On-Behalf-Of': String(agentId) },
  });

  return {
    async addIssueComment(agentId, issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.post(
        `/projects/${projectKey}/issues/${number}/comments`,
        { body },
        onBehalfOf(agentId),
      );
    },

    async updateIssueStatus(agentId, issueKey, statusKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(
        `/projects/${projectKey}/issues/${number}/status`,
        { status: statusKey },
        onBehalfOf(agentId),
      );
    },

    async getIssueDetail(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(`/projects/${projectKey}/issues/${number}`, onBehalfOf(agentId));
      const raw = r.data ?? {};
      const normalized = {
        ...raw,
        issueKey: raw.issueKey ?? raw.key ?? issueKey,
      };
      return issueDetail.parse(normalized);
    },

    async unassignSelf(agentId, issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/assignees`,
        onBehalfOf(agentId),
      );
      const current: { id: number }[] = Array.isArray(r.data) ? r.data : [];
      const next = current.filter((u) => u.id !== agentId).map((u) => u.id);
      await http.put(
        `/projects/${projectKey}/issues/${number}/assignees`,
        { userIds: next },
        onBehalfOf(agentId),
      );
    },

    async getOAuthToken(agentId) {
      const r = await http.get('/users/me/oauth-token', onBehalfOf(agentId));
      return {
        token: String(r.data?.token ?? ''),
        label: r.data?.label ?? null,
      };
    },
  };
}
