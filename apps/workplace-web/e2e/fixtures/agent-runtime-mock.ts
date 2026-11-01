// AI 실행(WP-1245) 조회 모킹 — 에이전트 관리 화면이 늘 부르는 템플릿·목록 요약·실행 설정·실행 위치·맡는 프로젝트를 「실행 설정 없음」으로 깐다.
// 요약이 실패하면 화면이 외부 AI 의 연결 안내를 숨기므로(Works 가 키를 관리하는 AI 에 수동 키를 주지 않게), 에이전트 화면 E2E 는 이것을 먼저 부른다.
import type { Page } from '@playwright/test';

import type { AgentTemplate } from '../../src/types/agentRuntime';

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

export const AGENT_TEMPLATES: AgentTemplate[] = [
  { name: 'default', version: '1', kind: 'SERVER', card: { title: '기본', description: '이슈·멘션에 바로 답합니다', skills: [] }, image: null, requires: [], config: [], resources: null },
  {
    name: 'claude-code',
    version: '1',
    kind: 'WORKSPACE',
    card: { title: 'Claude Code', description: '작업 공간에서 개발·테스트하고 PR 을 올립니다', skills: ['개발', '테스트', 'PR'] },
    image: 'x',
    requires: ['claude', 'github'],
    config: [
      { key: 'model', label: '모델', type: 'select', options: [{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }], default: 'opus', required: true },
      { key: 'queue', label: '대기열 라벨', type: 'text', options: [], default: 'AI 개발팀', required: false },
    ],
    resources: { cpuRequest: '4', memoryRequest: '8Gi', cpuLimit: '8', memoryLimit: '16Gi', workDisk: '50Gi' },
  },
];

export async function mockAgentRuntimeNone(page: Page) {
  await page.route('**/api/v1/admin/agent-templates', (r) => r.fulfill(json(AGENT_TEMPLATES)));
  await page.route('**/api/v1/admin/agent-runtime-summaries', (r) => r.fulfill(json([])));
  await page.route('**/api/v1/admin/agent-locations', (r) => (r.request().method() === 'GET' ? r.fulfill(json([])) : r.fallback()));
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/runtime-setting\/projects$/, (r) => r.fulfill(json([])));
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/runtime-setting$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ message: '실행 설정 없음' }, 404)) : r.fallback(),
  );
}
