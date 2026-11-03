// loadConfig — env 를 읽어 runner 설정을 만든다. 잘못된 값이면 시작하지 않는다. 토큰은 파일에서만.
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const BASE = {
  WORKS_URL: 'https://genia-works.iacloud.kr/',
  RUNNER_TOKEN_FILE: '/var/run/genia/runner-token',
  NAMESPACE: 'agents',
  ALLOWED_IMAGE_PREFIXES: 'docker.io/iacloudops/genia-works-agent-, docker:',
};
const readFile = (path: string) => {
  if (path !== '/var/run/genia/runner-token') throw new Error(`unexpected ${path}`);
  return 'rt_abc\n';
};

describe('loadConfig', () => {
  it('readsEnvWithDefaults', () => {
    expect(loadConfig(BASE, readFile)).toEqual({
      worksUrl: 'https://genia-works.iacloud.kr',
      runnerToken: 'rt_abc',
      namespace: 'agents',
      allowedImagePrefixes: ['docker.io/iacloudops/genia-works-agent-', 'docker:'],
      nodeSelector: {},
      tolerations: [],
      hostAliases: [],
      workDiskType: 'hostPath',
      workHostPath: '/var/lib/genia-agents',
      storageClass: undefined,
      caConfigMap: undefined,
      screenAllowInput: false,
      dindStorageLimit: '20Gi',
      dindResources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '2', memory: '4Gi' } },
      healthPort: 8080,
      terminationGraceSeconds: 60,
      imagePullSecrets: [],
    });
  });

  it('ignoresLeftoverGithubSecretName', () => {
    const cfg = loadConfig({ ...BASE, GITHUB_SECRET_NAME: 'github-token' }, readFile);
    expect(cfg).not.toHaveProperty('githubSecretName');
  });

  it('parsesLocationJsonValues', () => {
    const cfg = loadConfig(
      {
        ...BASE,
        AGENT_NODE_SELECTOR: '{"pool":"agents"}',
        AGENT_TOLERATIONS: '[{"key":"agents","operator":"Exists"}]',
        AGENT_HOST_ALIASES: '[{"ip":"10.0.0.5","hostnames":["gitlab.local"]}]',
        AGENT_STORAGE_CLASS: 'fast',
        AGENT_CA_CONFIGMAP: ' agent-ca ',
        SCREEN_ALLOW_INPUT: 'true',
        DIND_STORAGE_LIMIT: '40Gi',
        TERMINATION_GRACE_SECONDS: '90',
        AGENT_IMAGE_PULL_SECRETS: 'dockerhub-pull, other ',
        // Helm toJson 은 따옴표 없는 cpu: 4 를 숫자로 내보낸다 — 문자열로 받아들인다
        DIND_RESOURCES: '{"requests":{"cpu":"1","memory":"2Gi"},"limits":{"cpu":4,"memory":"8Gi"}}',
        HEALTH_PORT: '18080',
      },
      readFile,
    );
    expect(cfg.nodeSelector).toEqual({ pool: 'agents' });
    expect(cfg.caConfigMap).toBe('agent-ca');
    expect(cfg.screenAllowInput).toBe(true);
    expect(() => loadConfig({ ...BASE, SCREEN_ALLOW_INPUT: 'yes' }, readFile)).toThrow('SCREEN_ALLOW_INPUT 은 true 또는 false 여야 합니다');
    expect(cfg.tolerations).toEqual([{ key: 'agents', operator: 'Exists' }]);
    expect(cfg.hostAliases).toEqual([{ ip: '10.0.0.5', hostnames: ['gitlab.local'] }]);
    expect(cfg.storageClass).toBe('fast');
    expect(cfg.dindStorageLimit).toBe('40Gi');
    expect(cfg.terminationGraceSeconds).toBe(90);
    expect(cfg.imagePullSecrets).toEqual(['dockerhub-pull', 'other']);
    expect(cfg.dindResources).toEqual({ requests: { cpu: '1', memory: '2Gi' }, limits: { cpu: '4', memory: '8Gi' } });
    expect(cfg.healthPort).toBe(18080);
  });

  it.each([
    ['missing WORKS_URL', { WORKS_URL: undefined }],
    ['WORKS_URL not http', { WORKS_URL: 'ftp://x' }],
    ['missing NAMESPACE', { NAMESPACE: '' }],
    ['empty ALLOWED_IMAGE_PREFIXES', { ALLOWED_IMAGE_PREFIXES: ' , ' }],
    ['bad node selector json', { AGENT_NODE_SELECTOR: '{bad' }],
    ['node selector not string map', { AGENT_NODE_SELECTOR: '{"a":1}' }],
    ['tolerations not array', { AGENT_TOLERATIONS: '{}' }],
    ['bad grace seconds', { TERMINATION_GRACE_SECONDS: '-1' }],
    ['missing token file', { RUNNER_TOKEN_FILE: undefined }],
    ['bad dind resources json', { DIND_RESOURCES: '{bad' }],
    ['dind resources unknown field', { DIND_RESOURCES: '{"requests":{"cpu":"1","memory":"1Gi"},"claims":[]}' }],
    ['dind resources without requests', { DIND_RESOURCES: '{"limits":{"cpu":"1"}}' }],
    ['dind resources bad quantity', { DIND_RESOURCES: '{"requests":{"cpu":true,"memory":"1Gi"}}' }],
    ['bad health port', { HEALTH_PORT: '0' }],
  ])('rejects %s', (_name, patch) => {
    expect(() => loadConfig({ ...BASE, ...patch }, readFile)).toThrow();
  });

  it('loadConfig_whenWorksUrlInvalidAndTokenFileMissing_reportsWorksUrlError', () => {
    const missing = (): string => {
      throw new Error('ENOENT');
    };
    expect(() => loadConfig({ ...BASE, WORKS_URL: 'ftp://x' }, missing)).toThrow(/WORKS_URL 은 http\(s\)/);
  });

  it('loadConfig_whenTokenFileMissing_propagatesReadError', () => {
    const missing = (): string => {
      throw new Error('ENOENT');
    };
    expect(() => loadConfig(BASE, missing)).toThrow('ENOENT');
  });

  it('rejectsEmptyTokenFile', () => {
    expect(() => loadConfig(BASE, () => '  \n')).toThrow(/RUNNER_TOKEN_FILE/);
  });

  it('loadConfig_whenWorkDiskTypePvcAndHostPathTrailingSlash_readsBoth', () => {
    const cfg = loadConfig({ ...BASE, AGENT_WORK_DISK_TYPE: 'pvc', AGENT_WORK_HOST_PATH: '/data/agents/' }, readFile);
    expect(cfg.workDiskType).toBe('pvc');
    expect(cfg.workHostPath).toBe('/data/agents');
  });

  it('loadConfig_whenWorkDiskTypeUnknown_fails', () => {
    expect(() => loadConfig({ ...BASE, AGENT_WORK_DISK_TYPE: 'nfs' }, readFile)).toThrow('AGENT_WORK_DISK_TYPE 은 hostPath 또는 pvc 여야 합니다');
  });

  it('loadConfig_whenWorkHostPathRelative_fails', () => {
    expect(() => loadConfig({ ...BASE, AGENT_WORK_HOST_PATH: 'data/agents' }, readFile)).toThrow('AGENT_WORK_HOST_PATH 는 절대 경로여야 합니다');
  });
});

