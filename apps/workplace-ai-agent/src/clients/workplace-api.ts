// workplace-api 호출용 axios 인스턴스 + 메서드 시그니처.
// 본 epic 은 호출 미구현 — 모든 메서드가 즉시 throw. Phase 5c 에서 채운다.
import axios, { AxiosInstance } from 'axios';

import { DEFAULT_API_BASE_URL } from '../constants.js';

export interface WorkplaceApiClient {
  // 이슈에 코멘트 작성 — AGENT 권한 (Phase 5c).
  addIssueComment(issueKey: string, body: string): Promise<void>;
  // 이슈 상태 변경 — AGENT 권한 (Phase 5c).
  updateIssueStatus(issueKey: string, statusKey: string): Promise<void>;
}

const NOT_IMPL = 'workplace-api client 는 스캐폴딩 단계에서 미구현 — Phase 5c 에서 채움';

export function createWorkplaceApiClient(opts: {
  baseURL?: string;
  apiKey: string;
}): WorkplaceApiClient {
  // axios 인스턴스는 Phase 5c 가 사용. 본 epic 은 생성만.
  const _http: AxiosInstance = axios.create({
    baseURL: opts.baseURL ?? DEFAULT_API_BASE_URL,
    headers: { 'X-Api-Key': opts.apiKey },
  });
  void _http; // 사용처 없음을 명시 — 5c 가 메서드 본문에서 사용

  return {
    async addIssueComment(_issueKey, _body) {
      throw new Error(NOT_IMPL);
    },
    async updateIssueStatus(_issueKey, _statusKey) {
      throw new Error(NOT_IMPL);
    },
  };
}
