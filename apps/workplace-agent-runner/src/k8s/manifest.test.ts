// Pod·PVC·ConfigMap 이 계약 문서(agent-pod-contract.md)의 이름·라벨·마운트·env·dind 배선과 맞는지 단언한다.
import { describe, expect, it } from 'vitest';
import type { V1Container, V1Pod } from '@kubernetes/client-node';
import { buildAgentResources, buildAgentSecret, podGeneration } from './manifest.js';
import { ctx, desiredAgent, runnerConfig } from '../testing/fixtures.js';

function container(pod: V1Pod, name: string): V1Container {
  const c = pod.spec?.containers.find((x) => x.name === name);
  if (!c) throw new Error(`container ${name} not found`);
  return c;
}

/** 마운트 경로 → {볼륨 출처, subPath} 표 — 계약 표와 그대로 비교하려고. */
function mountTable(pod: V1Pod, name: string) {
  const volumes = new Map((pod.spec?.volumes ?? []).map((v) => [v.name, v]));
  const out: Record<string, { source: string; subPath?: string; readOnly?: boolean }> = {};
  for (const m of container(pod, name).volumeMounts ?? []) {
    const v = volumes.get(m.name);
    const source = v?.configMap
      ? `configMap:${v.configMap.name}`
      : v?.secret
        ? `secret:${v.secret.secretName}`
        : v?.persistentVolumeClaim
          ? `pvc:${v.persistentVolumeClaim.claimName}`
          : v?.emptyDir
            ? 'emptyDir'
            : 'unknown';
    out[m.mountPath] = { source, subPath: m.subPath, readOnly: m.readOnly };
  }
  return out;
}

describe('buildAgentResources', () => {
  it('buildsPodWithContractEnvMountsAndLabels', () => {
    const { pod, pvc: maybePvc, configMap } = buildAgentResources(desiredAgent(), ctx, runnerConfig());
    const pvc = maybePvc!;

    // 이름·라벨
    expect(pod.apiVersion).toBe('v1');
    expect(pod.kind).toBe('Pod');
    expect(pod.metadata?.name).toBe('agent-42');
    expect(pod.metadata?.namespace).toBe('agents');
    expect(pod.metadata?.labels).toEqual({
      'app.kubernetes.io/managed-by': 'genia-agent-runner',
      'genia.works/agent': '42',
      'genia.works/location': '3',
      'genia.works/generation': '7',
    });
    for (const r of [pvc, configMap]) {
      expect(r.metadata?.labels).toEqual({
        'app.kubernetes.io/managed-by': 'genia-agent-runner',
        'genia.works/agent': '42',
        'genia.works/location': '3',
      });
      expect(r.metadata?.namespace).toBe('agents');
    }
    expect(pvc.metadata?.name).toBe('agent-42-work');
    expect(configMap.metadata?.name).toBe('agent-42');

    // 사용자·디스크 배치 — Pod 에는 fsGroup 만(특권 dind 가 root 로 돌아야 해서), agent 컨테이너가 1001
    expect(pod.spec?.securityContext).toEqual({ fsGroup: 1001 });
    const agent = container(pod, 'agent');
    expect(agent.securityContext).toMatchObject({ runAsUser: 1001, runAsGroup: 1001, runAsNonRoot: true });
    expect(agent.image).toBe('docker.io/iacloudops/genia-works-agent-claude-code:0.9.40');
    expect(pod.spec?.restartPolicy).toBe('Always');
    expect(pod.spec?.terminationGracePeriodSeconds).toBe(60);

    // env 표
    const env = Object.fromEntries((agent.env ?? []).map((e) => [e.name, e]));
    expect(env.GENIA_AGENT_NAME?.value).toBe('dev-ai');
    expect(env.GENIA_AGENT_GENERATION?.value).toBe('7');
    expect(env.GENIA_WORKS_TENANT?.value).toBe('1');
    expect(env.GENIA_WORKS_API_URL?.value).toBe('https://works.example.test/api/v1');
    expect(env.GENIA_WORKS_MCP_URL?.value).toBe('https://works.example.test/mcp');
    expect(env.DOCKER_HOST?.value).toBe('unix:///dind/docker.sock');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN?.valueFrom?.secretKeyRef).toEqual({
      name: 'agent-42',
      key: 'claude-token',
      optional: true,
    });

    // 마운트 표
    expect(mountTable(pod, 'agent')).toEqual({
      '/run/genia/config.json': { source: 'configMap:agent-42', subPath: 'config.json', readOnly: true },
      '/run/genia/agent-key': { source: 'secret:agent-42', subPath: 'agent-key', readOnly: true },
      '/work': { source: 'pvc:agent-42-work', subPath: undefined, readOnly: undefined },
      '/dind': { source: 'emptyDir', subPath: undefined, readOnly: undefined },
    });

    // 자원
    expect(agent.resources).toEqual({
      requests: { cpu: '4', memory: '8Gi' },
      limits: { cpu: '8', memory: '16Gi' },
    });

    // config.json
    expect(JSON.parse(configMap.data?.['config.json'] ?? '{}')).toEqual({
      agent: { userId: 42, username: 'dev-ai', tenantId: 1, generation: 7 },
      works: { apiUrl: 'https://works.example.test/api/v1', mcpUrl: 'https://works.example.test/mcp' },
      template: { name: 'claude-code', version: '1' },
      config: { model: 'opus', queue: 'AI 개발팀' },
      plugins: [{ marketplace: 'genia-works', name: 'genia-works', version: '0.1.31' }],
    });
  });

  it('wiresDindSidecarWhenNamedDind', () => {
    const agent = desiredAgent({
      sidecars: [
        { name: 'dind', image: 'docker:27-dind', privileged: true },
        { name: 'other', image: 'docker:27-cli', privileged: false },
      ],
    });
    const { pod } = buildAgentResources(agent, ctx, runnerConfig({ dindStorageLimit: '30Gi' }));

    const dind = container(pod, 'dind');
    expect(dind.image).toBe('docker:27-dind');
    expect(dind.securityContext).toEqual({ privileged: true });
    expect(dind.args).toEqual(['--host=unix:///dind/docker.sock', '--group=1001']);
    expect(dind.env).toEqual([{ name: 'DOCKER_TLS_CERTDIR', value: '' }]);
    expect(mountTable(pod, 'dind')).toEqual({
      '/var/lib/docker': { source: 'emptyDir', subPath: undefined, readOnly: undefined },
      '/dind': { source: 'emptyDir', subPath: undefined, readOnly: undefined },
    });
    const storage = pod.spec?.volumes?.find((v) => v.name === 'dind-storage');
    expect(storage?.emptyDir?.sizeLimit).toBe('30Gi');
    // agent 와 dind 가 같은 소켓 볼륨을 나눠 쓴다
    const sockOf = (name: string) => container(pod, name).volumeMounts?.find((m) => m.mountPath === '/dind')?.name;
    expect(sockOf('agent')).toBe(sockOf('dind'));

    // 다른 이름의 sidecar 는 배선 없이 이름·이미지·privileged 만
    expect(container(pod, 'other')).toEqual({
      name: 'other',
      image: 'docker:27-cli',
      securityContext: { privileged: false },
      resources: { requests: { cpu: '100m', memory: '128Mi' } },
    });
  });

  it('appliesLocationNodeSelectorTolerationsHostAliases', () => {
    const cfg = runnerConfig({
      nodeSelector: { 'node-role/agents': 'true' },
      tolerations: [{ key: 'agents', operator: 'Exists', effect: 'NoSchedule' }],
      hostAliases: [{ ip: '10.0.0.5', hostnames: ['gitlab.iacloud.kr'] }],
      terminationGraceSeconds: 90,
    });
    const { pod } = buildAgentResources(desiredAgent(), ctx, cfg);

    expect(pod.spec?.nodeSelector).toEqual({ 'node-role/agents': 'true' });
    expect(pod.spec?.tolerations).toEqual([{ key: 'agents', operator: 'Exists', effect: 'NoSchedule' }]);
    expect(pod.spec?.hostAliases).toEqual([{ ip: '10.0.0.5', hostnames: ['gitlab.iacloud.kr'] }]);
    expect(pod.spec?.terminationGracePeriodSeconds).toBe(90);
  });

  it('doesNotMountServiceAccountTokenAndUsesPullSecrets', () => {
    const plain = buildAgentResources(desiredAgent(), ctx, runnerConfig()).pod;
    expect(plain.spec?.automountServiceAccountToken).toBe(false);
    expect(plain.spec?.imagePullSecrets).toBeUndefined();

    const { pod } = buildAgentResources(desiredAgent(), ctx, runnerConfig({ imagePullSecrets: ['dockerhub-pull'] }));
    expect(pod.spec?.imagePullSecrets).toEqual([{ name: 'dockerhub-pull' }]);
  });

  it('omitsClaudeEnvWhenNoClaudeSecret', () => {
    const agent = desiredAgent({
      secrets: [{ name: 'agent-key', source: 'WORKS', version: 812, rotateAfter: null }],
    });
    const { pod } = buildAgentResources(agent, ctx, runnerConfig());

    const names = (container(pod, 'agent').env ?? []).map((e) => e.name);
    expect(names).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(names).toContain('GENIA_AGENT_NAME');
  });

  it('everyContainerHasRequestsForQuota', () => {
    // 네임스페이스 ResourceQuota(requests.cpu/memory)가 켜져 있으면 requests 없는 컨테이너가 하나라도 있으면 Pod 가 거절된다
    const agent = desiredAgent({
      resources: { workDisk: '50Gi' },
      sidecars: [
        { name: 'dind', image: 'docker:27-dind', privileged: true },
        { name: 'other', image: 'docker:27-cli', privileged: false },
      ],
    });
    const { pod } = buildAgentResources(agent, ctx, runnerConfig());
    for (const c of pod.spec?.containers ?? []) {
      expect(c.resources?.requests?.cpu, c.name).toBeTruthy();
      expect(c.resources?.requests?.memory, c.name).toBeTruthy();
    }
    // 템플릿 자원이 없으면 계약의 기본값
    expect(container(pod, 'agent').resources).toEqual({ requests: { cpu: '1', memory: '2Gi' } });
    // dind 는 위치 값(DIND_RESOURCES) 그대로
    expect(container(pod, 'dind').resources).toEqual(runnerConfig().dindResources);
    expect(container(pod, 'other').resources).toEqual({ requests: { cpu: '100m', memory: '128Mi' } });

    // limit 만 있으면 request 를 limit 으로 채운다(기본값이 limit 보다 커서 검증에 걸리지 않게)
    const limitsOnly = buildAgentResources(
      desiredAgent({ resources: { cpuLimit: '500m', memoryLimit: '1Gi', workDisk: '10Gi' } }),
      ctx,
      runnerConfig(),
    ).pod;
    expect(container(limitsOnly, 'agent').resources).toEqual({
      requests: { cpu: '500m', memory: '1Gi' },
      limits: { cpu: '500m', memory: '1Gi' },
    });

    // 위치가 dind 자원을 바꾸면 그 값
    const custom = { requests: { cpu: '1', memory: '2Gi' }, limits: { memory: '8Gi' } };
    const { pod: customPod } = buildAgentResources(agent, ctx, runnerConfig({ dindResources: custom }));
    expect(container(customPod, 'dind').resources).toEqual(custom);
  });

  it('recordsClaudeVersionAnnotationOnPod', () => {
    const withClaude = buildAgentResources(desiredAgent(), ctx, runnerConfig(), { claudeVersion: '57' }).pod;
    expect(withClaude.metadata?.annotations).toEqual({ 'genia.works/claude-version': '57' });
    // 받은 연결이 없으면 어노테이션을 두지 않는다(없음 ↔ 값 비교가 그대로 되게)
    const none = buildAgentResources(desiredAgent(), ctx, runnerConfig()).pod;
    expect(none.metadata?.annotations?.['genia.works/claude-version']).toBeUndefined();
  });

  it('mountsRepoTokensVolumeFromSecretItemsPerHost', () => {
    const repos = { version: '1730505600000', hosts: 'GITHUB:ghe.example.com,GITHUB:github.com,GITLAB:gitlab.iacloud.kr' };
    const { pod } = buildAgentResources(desiredAgent(), ctx, runnerConfig(), { claudeVersion: '57', repos });
    const vol = pod.spec?.volumes?.find((v) => v.name === 'repo-tokens');
    expect(vol?.secret?.secretName).toBe('agent-42');
    expect(vol?.secret?.items).toEqual([
      { key: 'repo-github-ghe.example.com', path: 'github/ghe.example.com' },
      { key: 'repo-github-github.com', path: 'github/github.com' },
      { key: 'repo-gitlab-gitlab.iacloud.kr', path: 'gitlab/gitlab.iacloud.kr' },
    ]);
    const mount = pod.spec?.containers.find((c) => c.name === 'agent')?.volumeMounts?.find((m) => m.name === 'repo-tokens');
    expect(mount).toEqual({ name: 'repo-tokens', mountPath: '/run/genia/repo-tokens', readOnly: true });
    expect(pod.metadata?.annotations).toEqual({
      'genia.works/claude-version': '57',
      'genia.works/repos-version': '1730505600000',
    });
  });

  it('omitsRepoTokensVolumeAndLegacyGithubMountWithoutHosts', () => {
    const { pod } = buildAgentResources(desiredAgent(), ctx, runnerConfig(), { claudeVersion: '57', repos: { version: '5' } });
    expect(pod.spec?.volumes?.some((v) => v.name === 'repo-tokens' || v.name === 'github-token')).toBe(false);
    const mounts = pod.spec?.containers.find((c) => c.name === 'agent')?.volumeMounts ?? [];
    expect(mounts.some((m) => m.mountPath.includes('github-token') || m.mountPath.includes('repo-tokens'))).toBe(false);
    expect(pod.metadata?.annotations?.['genia.works/repos-version']).toBe('5');
  });

  it('podGenerationParsesLabel', () => {
    const { pod } = buildAgentResources(desiredAgent(), ctx, runnerConfig());
    expect(podGeneration(pod)).toBe(7);
    expect(podGeneration({ metadata: { labels: { 'genia.works/generation': 'x' } } })).toBeNull();
    expect(podGeneration({ metadata: {} })).toBeNull();
  });

  it('pvcUsesConfiguredStorageClassAndWorkDisk', () => {
    const withClass = buildAgentResources(desiredAgent(), ctx, runnerConfig({ storageClass: 'fast-ssd' })).pvc!;
    expect(withClass.spec).toEqual({
      accessModes: ['ReadWriteOnce'],
      storageClassName: 'fast-ssd',
      resources: { requests: { storage: '50Gi' } },
    });

    // storageClass 를 정하지 않으면 칸을 비워 클러스터 기본을 쓴다
    const noClass = buildAgentResources(desiredAgent(), ctx, runnerConfig()).pvc!;
    expect(noClass.spec?.storageClassName).toBeUndefined();
    expect(noClass.spec?.resources?.requests?.storage).toBe('50Gi');
  });
});

describe('buildAgentSecret', () => {
  it('buildsSecretWithBase64DataAndAnnotations', () => {
    const secret = buildAgentSecret(
      42,
      3,
      'agents',
      { 'agent-key': 'ak_x', 'claude-token': 'sk-ant-y' },
      { 'genia.works/agent-key-id': '812' },
    );
    expect(secret.metadata?.name).toBe('agent-42');
    expect(secret.metadata?.labels?.['app.kubernetes.io/managed-by']).toBe('genia-agent-runner');
    expect(secret.metadata?.annotations).toEqual({ 'genia.works/agent-key-id': '812' });
    expect(secret.type).toBe('Opaque');
    expect(secret.data).toEqual({
      'agent-key': Buffer.from('ak_x').toString('base64'),
      'claude-token': Buffer.from('sk-ant-y').toString('base64'),
    });
  });

  /** WP-1270 — 기본(hostPath) 방식은 PVC 없이 노드 로컬 폴더를 쓰고, 폴더 주인을 맞추는 init 컨테이너를 둔다. */
  it('hostPathWorkDisk_mountsNodeFolderWithoutPvc', () => {
    const cfg = runnerConfig({ workDiskType: 'hostPath', workHostPath: '/var/lib/genia-agents' });
    const { pod, pvc } = buildAgentResources(desiredAgent(), ctx, cfg);

    expect(pvc).toBeUndefined();
    expect(pod.spec?.volumes?.find((v) => v.name === 'work')).toEqual({
      name: 'work',
      hostPath: { path: '/var/lib/genia-agents/agent-42', type: 'DirectoryOrCreate' },
    });
    expect(pod.spec?.initContainers).toEqual([
      expect.objectContaining({
        name: 'work-owner',
        image: desiredAgent().image,
        command: ['chown', '1001:1001', '/work'],
        securityContext: { runAsUser: 0, runAsGroup: 0, runAsNonRoot: false },
        // 쿼터 승인 — init 컨테이너도 requests 가 있어야 한다
        resources: { requests: { cpu: '100m', memory: '128Mi' } },
        volumeMounts: [{ name: 'work', mountPath: '/work' }],
      }),
    ]);
    // 기록한 노드가 없으면(처음 뜰 때) 어느 노드든 고른다
    expect(pod.spec?.affinity).toBeUndefined();
  });

  it('hostPathWorkDisk_withRecordedNode_pinsPodToThatNode', () => {
    const cfg = runnerConfig({ workDiskType: 'hostPath', nodeSelector: { pool: 'agents' } });
    const { pod } = buildAgentResources(desiredAgent(), ctx, cfg, { workNode: 'node-b' });

    expect(pod.spec?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution).toEqual({
      nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: ['node-b'] }] }],
    });
    // 위치의 nodeSelector 는 그대로 함께 둔다
    expect(pod.spec?.nodeSelector).toEqual({ pool: 'agents' });
  });

  it('pvcWorkDisk_ignoresRecordedNodeAndHasNoInitContainer', () => {
    const { pod, pvc } = buildAgentResources(desiredAgent(), ctx, runnerConfig({ workDiskType: 'pvc' }), { workNode: 'node-b' });

    expect(pvc?.metadata?.name).toBe('agent-42-work');
    expect(pod.spec?.initContainers).toBeUndefined();
    expect(pod.spec?.affinity).toBeUndefined();
  });
});
