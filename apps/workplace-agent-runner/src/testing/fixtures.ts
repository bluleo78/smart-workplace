// 테스트 공용 픽스처 — 계약 문서(agent-runner-api.md)의 desired 예시와 같은 모양의 AI 한 명과 runner 설정.
import type { RunnerConfig } from '../config.js';
import type { RunnerDesiredAgent } from '../works/client.js';

/** 계약 문서 예시 그대로의 AI(42, dev-ai, generation 7) — 필요한 칸만 덮어쓴다. */
export function desiredAgent(overrides: Partial<RunnerDesiredAgent> = {}): RunnerDesiredAgent {
  return {
    agentUserId: 42,
    username: 'dev-ai',
    tenantId: 1,
    generation: 7,
    applyNow: true,
    templateName: 'claude-code',
    templateVersion: '1',
    image: 'docker.io/iacloudops/genia-works-agent-claude-code:0.9.40',
    resources: {
      cpuRequest: '4',
      memoryRequest: '8Gi',
      cpuLimit: '8',
      memoryLimit: '16Gi',
      workDisk: '50Gi',
    },
    sidecars: [{ name: 'dind', image: 'docker:27-dind', privileged: true }],
    plugins: [{ marketplace: 'genia-works', name: 'genia-works', version: '0.1.31' }],
    config: { model: 'opus', queue: 'AI 개발팀' },
    secrets: [
      { name: 'agent-key', source: 'WORKS', version: 812, rotateAfter: '2026-11-24T10:00:00+09:00' },
      { name: 'claude', source: 'WORKS', version: 57, rotateAfter: null },
      { name: 'github', source: 'LOCATION', version: null, rotateAfter: null },
    ],
    ...overrides,
  };
}

/** 테스트용 runner 설정 — 위치 값(nodeSelector 등)은 비워 두고 필요한 테스트만 채운다. */
export function runnerConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    worksUrl: 'https://works.example.test',
    runnerToken: 'rt_test',
    namespace: 'agents',
    allowedImagePrefixes: ['docker.io/iacloudops/genia-works-agent-', 'docker:'],
    nodeSelector: {},
    tolerations: [],
    hostAliases: [],
    storageClass: undefined,
    githubSecretName: 'github-token',
    dindStorageLimit: '20Gi',
    dindResources: { requests: { cpu: '500m', memory: '1Gi' }, limits: { cpu: '4', memory: '6Gi' } },
    healthPort: 8080,
    terminationGraceSeconds: 60,
    imagePullSecrets: [],
    ...overrides,
  };
}

/** 계약 문서의 desired 공통 값(위치·주소). */
export const ctx = {
  locationId: 3,
  apiUrl: 'https://works.example.test/api/v1',
  mcpUrl: 'https://works.example.test/mcp',
};
