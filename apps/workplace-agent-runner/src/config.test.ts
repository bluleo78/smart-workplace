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
      dindStorageLimitKib: 20 * 1024 * 1024,
      dindGcThresholdPercent: 70,
      dindResources: { requests: { cpu: '250m', memory: '512Mi' }, limits: { cpu: '2', memory: '4Gi' } },
      healthPort: 8080,
      clusterCheckSeconds: 30,
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
        DIND_GC_THRESHOLD_PERCENT: '80',
        TERMINATION_GRACE_SECONDS: '90',
        AGENT_IMAGE_PULL_SECRETS: 'dockerhub-pull, other ',
        // Helm toJson 은 따옴표 없는 cpu: 4 를 숫자로 내보낸다 — 문자열로 받아들인다
        DIND_RESOURCES: '{"requests":{"cpu":"1","memory":"2Gi"},"limits":{"cpu":4,"memory":"8Gi"}}',
        HEALTH_PORT: '18080',
        CLUSTER_CHECK_SECONDS: '45',
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
    expect(cfg.dindStorageLimitKib).toBe(40 * 1024 * 1024);
    expect(cfg.dindGcThresholdPercent).toBe(80);
    expect(cfg.terminationGraceSeconds).toBe(90);
    expect(cfg.imagePullSecrets).toEqual(['dockerhub-pull', 'other']);
    expect(cfg.dindResources).toEqual({ requests: { cpu: '1', memory: '2Gi' }, limits: { cpu: '4', memory: '8Gi' } });
    expect(cfg.healthPort).toBe(18080);
    expect(cfg.clusterCheckSeconds).toBe(45);
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
    // 클러스터 다시 보기(WP-1501) — 너무 짧으면 API 서버를 두드리고, 주기 조회(300초)보다 길면 뜻이 없다
    ['cluster check too short', { CLUSTER_CHECK_SECONDS: '4' }],
    ['cluster check too long', { CLUSTER_CHECK_SECONDS: '301' }],
    // DinD 정리(WP-1581) — 상한을 KiB 로 바꿔 임계값을 재므로 읽을 수 없는 상한은 시작 실패
    ['unreadable dind storage limit', { DIND_STORAGE_LIMIT: 'lots' }],
    // 너무 작은 상한(바이트로 잘못 적음 등)은 임계값이 0 에 가까워 매번 다 지운다
    ['dind storage limit under 1Gi', { DIND_STORAGE_LIMIT: '500' }],
    ['dind gc threshold zero', { DIND_GC_THRESHOLD_PERCENT: '0' }],
    ['dind gc threshold over 100', { DIND_GC_THRESHOLD_PERCENT: '101' }],
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


