// workplace-api 호출용 axios 인스턴스. AGENT API key 인증.
// 5c-2 에서 LLM 도구가 호출할 메서드 추가:
//   - getIssueDetail / updateIssueStatus / unassignSelf
// /users/me 는 프로세스 수명 동안 캐시 (1회만 호출).
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';
import {
  IssueDetail,
  SelfUser,
  issueDetail,
  selfUser,
} from '../types/workplace-api.js';

export interface WorkplaceApiClient {
  // 이슈에 코멘트 작성 — AGENT 권한.
  addIssueComment(issueKey: string, body: string): Promise<void>;
  // 이슈 상태 변경.
  updateIssueStatus(issueKey: string, statusKey: string): Promise<void>;
  // 이슈 상세 조회 — LLM 컨텍스트용.
  getIssueDetail(issueKey: string): Promise<IssueDetail>;
  // 자기 자신만 assignee 에서 제거.
  unassignSelf(issueKey: string): Promise<void>;
  // 캐시된 self user id 조회 (테스트 보조).
  getCachedSelfUserId(): Promise<number>;
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

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  apiKey: string;
}): WorkplaceApiClient {
  const http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { 'X-Api-Key': opts.apiKey },
  });

  // /users/me 결과는 프로세스 수명 동안 변하지 않으므로 한 번만 호출.
  let selfPromise: Promise<SelfUser> | null = null;
  async function fetchSelf(): Promise<SelfUser> {
    if (!selfPromise) {
      selfPromise = http
        .get('/users/me')
        .then((r) => selfUser.parse(r.data))
        .catch((e) => {
          // 캐시 무효화 — 다음 호출이 다시 시도하도록.
          selfPromise = null;
          throw e;
        });
    }
    return selfPromise;
  }

  return {
    async addIssueComment(issueKey, body) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.post(`/projects/${projectKey}/issues/${number}/comments`, {
        body,
      });
    },

    async updateIssueStatus(issueKey, statusKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      await http.patch(`/projects/${projectKey}/issues/${number}/status`, {
        status: statusKey,
      });
    },

    async getIssueDetail(issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const r = await http.get(`/projects/${projectKey}/issues/${number}`);
      // workplace-api 의 응답 필드는 `key` — 도구 LLM 노출용으로 `issueKey` 로 정규화.
      const raw = r.data ?? {};
      const normalized = {
        ...raw,
        issueKey: raw.issueKey ?? raw.key ?? issueKey,
      };
      return issueDetail.parse(normalized);
    },

    async unassignSelf(issueKey) {
      const { projectKey, number } = parseIssueKey(issueKey);
      const me = await fetchSelf();
      const r = await http.get(
        `/projects/${projectKey}/issues/${number}/assignees`,
      );
      const current: { id: number }[] = Array.isArray(r.data) ? r.data : [];
      const next = current.filter((u) => u.id !== me.id).map((u) => u.id);
      await http.put(`/projects/${projectKey}/issues/${number}/assignees`, {
        userIds: next,
      });
    },

    async getCachedSelfUserId() {
      const me = await fetchSelf();
      return me.id;
    },
  };
}
