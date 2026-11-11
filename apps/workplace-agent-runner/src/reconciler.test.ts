// Reconciler — 가짜 클러스터·Works 로 조정 한 회차씩 돌려 Review Focus(키 재발급 폭주·applyNow·STOPPED)를 단언한다.
import { describe, expect, it, vi } from 'vitest';
import type { V1PersistentVolumeClaim, V1Pod, V1Secret } from '@kubernetes/client-node';
import { ClusterCheck, ReconcileLoop, Reconciler, type ReconcileResult } from './reconciler.js';
import { ClusterError } from './k8s/cluster.js';
import { buildAgentResources, buildAgentSecret } from './k8s/manifest.js';
import { FakeCluster, FakeWorks } from './testing/fakes.js';
import { ctx, desiredAgent, runnerConfig } from './testing/fixtures.js';
import type { RunnerDesired, RunnerDesiredAgent } from './works/client.js';

const NOW = new Date('2026-11-10T00:00:00Z');
/** 픽스처 desired 의 repos version(문자열) — seedRunningAgent 가 이 값으로 받아 둔 상태를 만든다. */
const REPOS_V = '1730505600000';
const REPO_MOUNT = { version: REPOS_V, hosts: 'GITHUB:github.com' };

function desired(agents: RunnerDesiredAgent[]): RunnerDesired {
  return {
    locationId: ctx.locationId,
    locationName: '운영 클러스터',
    generatedAt: NOW.toISOString(),
    pollIntervalSeconds: 300,
    mcpUrl: ctx.mcpUrl,
    apiUrl: ctx.apiUrl,
    agents,
  };
}

/** runner 가 기록을 남긴 채 떠 있는 AI 한 명(재시작 직전 상태)을 클러스터에 넣는다. Pod 는 모델 연결 57·저장소 토큰 version REPOS_V 로 만든 것. */
function seedRunningAgent(cluster: FakeCluster, agent: RunnerDesiredAgent, locationId = ctx.locationId, loginVersion?: string) {
  const { pod, pvc, configMap } = buildAgentResources(agent, { ...ctx, locationId }, runnerConfig(), {
    claudeVersion: '57',
    repos: REPO_MOUNT,
    loginVersion,
  });
  cluster.seed(pod);
  cluster.seed(pvc!);
  cluster.seed(configMap);
  cluster.seed(
    buildAgentSecret(
      agent.agentUserId,
      locationId,
      'agents',
      {
        'agent-key': 'ak_old',
        'claude-token': 'sk-ant-old',
        'repo-github-github.com': 'ghp_old',
        ...(loginVersion ? { 'login-info': '{"old":true}' } : {}),
      },
      {
        'genia.works/agent-key-id': '812',
        'genia.works/agent-key-rotate-after': '2026-11-24T01:00:00.000Z',
        'genia.works/claude-version': '57',
        'genia.works/repos-version': REPOS_V,
        'genia.works/repo-hosts': 'GITHUB:github.com',
        ...(loginVersion ? { 'genia.works/login-version': loginVersion } : {}),
      },
    ),
  );
}

function makeReconciler(cluster: FakeCluster, works: FakeWorks, logs: unknown[] = [], cfg = runnerConfig()) {
  const log = {
    info: (...a: unknown[]) => logs.push(a),
    warn: (...a: unknown[]) => logs.push(a),
    error: (...a: unknown[]) => logs.push(a),
  };
  return new Reconciler({ cluster, works, cfg, now: () => NOW, log });
}

function decodeSecret(cluster: FakeCluster, name: string) {
  const s = cluster.get<V1Secret>('Secret', name);
  return Object.fromEntries(Object.entries(s?.data ?? {}).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()]));
}

describe('Reconciler', () => {
  it('findRunningAgentPodOnlyForRunningPodOfThisLocation', async () => {
    // WP-1277 — 작업 화면은 내 위치 라벨의 Running Pod 에만 붙는다(같은 네임스페이스 다른 runner 의 AI 는 null)
    const cluster = new FakeCluster();
    const mine = desiredAgent({ agentUserId: 7 });
    const other = desiredAgent({ agentUserId: 8 });
    seedRunningAgent(cluster, mine);
    seedRunningAgent(cluster, other, ctx.locationId + 1);
    const reconciler = makeReconciler(cluster, new FakeWorks(desired([mine])));
    expect(await reconciler.findRunningAgentPod(7)).toBeNull(); // desired 를 받기 전
    await reconciler.reconcileOnce();
    const pod = cluster.get<V1Pod>('Pod', 'agent-7')!;
    pod.status = { phase: 'Running' };
    expect(await reconciler.findRunningAgentPod(7)).toBe('agent-7');
    expect(await reconciler.findRunningAgentPod(8)).toBeNull();
    pod.status = { phase: 'Pending' };
    expect(await reconciler.findRunningAgentPod(7)).toBeNull();
  });

  it('restartWithUnchangedDesiredDoesNotCallAgentKey', async () => {
    const cluster = new FakeCluster();
    const agent = desiredAgent();
    seedRunningAgent(cluster, agent);
    const works = new FakeWorks(desired([agent]));

    // runner 가 막 다시 떴다 — 메모리에는 아무것도 없고 Secret 어노테이션만 기록이다
    await makeReconciler(cluster, works).reconcileOnce();
    await makeReconciler(cluster, works).reconcileOnce();

    expect(works.issueAgentKey).not.toHaveBeenCalled();
    expect(works.getClaudeSecret).not.toHaveBeenCalled();
    expect(cluster.calls).toEqual([]);
  });

  it('fetchesAgentKeyOnceForNewAgentAndRecordsKeyId', async () => {
    const cluster = new FakeCluster();
    cluster.instantPodDelete = true;
    const logs: unknown[] = [];
    // 첫 발급 전 — Works 에 키가 없다(version null)
    const agent = desiredAgent({
      secrets: [
        { name: 'agent-key', source: 'WORKS', version: null, rotateAfter: null },
        { name: 'claude', source: 'WORKS', version: 57, rotateAfter: null },
      ],
    });
    const works = new FakeWorks(desired([agent]));
    const r = makeReconciler(cluster, works, logs);

    await r.reconcileOnce();
    expect(works.issueAgentKey).toHaveBeenCalledTimes(1);
    const secret = cluster.get<V1Secret>('Secret', 'agent-42');
    expect(secret?.metadata?.annotations).toEqual({
      'genia.works/agent-key-id': '942',
      'genia.works/agent-key-rotate-after': '2026-11-24T01:00:00.000Z',
      'genia.works/claude-version': '57',
    });
    expect(decodeSecret(cluster, 'agent-42')).toEqual({ 'agent-key': 'ak_plain_42', 'claude-token': 'sk-ant-plain' });
    expect(cluster.get('Pod', 'agent-42')).toBeDefined();

    // 다음 desired 는 받은 키 id 를 싣는다 — 다시 부르지 않는다
    works.desired = desired([
      { ...agent, secrets: [{ name: 'agent-key', source: 'WORKS', version: 942, rotateAfter: '2026-11-24T10:00:00+09:00' }, agent.secrets[1]!] },
    ]);
    await r.reconcileOnce();
    await makeReconciler(cluster, works, logs).reconcileOnce();
    expect(works.issueAgentKey).toHaveBeenCalledTimes(1);

    // 원문은 어떤 로그에도 남지 않는다
    expect(JSON.stringify(logs)).not.toContain('ak_plain_42');
    expect(JSON.stringify(logs)).not.toContain('sk-ant-plain');
  });

  it('reportsStoppedAfterPodGoneThenDeletesConfigMap', async () => {
    const cluster = new FakeCluster();
    seedRunningAgent(cluster, desiredAgent());
    const works = new FakeWorks(desired([]));

    // 1회차 — Pod·PVC·Secret 을 지우고 ConfigMap 은 남긴다. Pod 는 아직 지우는 중이라 STOPPED 를 보내지 않는다
    const first = await makeReconciler(cluster, works).reconcileOnce();
    expect(cluster.calls).toEqual(['delete Pod/agent-42', 'delete PersistentVolumeClaim/agent-42-work', 'delete Secret/agent-42']);
    expect(cluster.get('ConfigMap', 'agent-42')).toBeDefined();
    expect(works.reportObserved).not.toHaveBeenCalled();
    expect(first.retry).toBe('wait');

    // 지우는 중에 runner 가 다시 떠도 같은 판단(Pod 를 거듭 지우지 않는다)
    cluster.calls.length = 0;
    await makeReconciler(cluster, works).reconcileOnce();
    expect(cluster.calls).toEqual([]);

    // Pod 가 사라졌다 — STOPPED 보고가 실패하면 ConfigMap 을 남긴다
    cluster.finishPodDeletion('agent-42');
    works.reportObserved.mockRejectedValueOnce(new Error('503'));
    const failed = await makeReconciler(cluster, works).reconcileOnce();
    expect(cluster.get('ConfigMap', 'agent-42')).toBeDefined();
    expect(failed.retry).toBe('soon');

    // 다음 회차(재시작한 runner 라도) — STOPPED 가 받아들여진 뒤에 ConfigMap 을 지운다
    cluster.calls.length = 0;
    await makeReconciler(cluster, works).reconcileOnce();
    expect(works.reportObserved).toHaveBeenLastCalledWith([
      expect.objectContaining({ agentUserId: 42, phase: 'STOPPED' }),
    ]);
    expect(cluster.calls).toEqual(['delete ConfigMap/agent-42']);
    expect(cluster.objects.size).toBe(0);
  });

  it('refusesDisallowedImageAndReportsFailed', async () => {
    const cluster = new FakeCluster();
    const works = new FakeWorks(desired([desiredAgent({ image: 'ghcr.io/evil/miner:1' })]));
    const r = makeReconciler(cluster, works);

    await r.reconcileOnce();
    expect(cluster.calls).toEqual([]);
    expect(works.issueAgentKey).not.toHaveBeenCalled();

    await r.reportObserved();
    expect(works.reportObserved).toHaveBeenCalledWith([
      expect.objectContaining({ agentUserId: 42, phase: 'FAILED', message: expect.stringContaining('ghcr.io/evil/miner:1') }),
    ], true);
  });

  it('doesNotCreatePodBeforeAgentKeySecretExists', async () => {
    const cluster = new FakeCluster();
    const works = new FakeWorks(desired([desiredAgent()]));
    works.issueAgentKey.mockRejectedValueOnce(new Error('Works 503'));
    const r = makeReconciler(cluster, works);

    const result = await r.reconcileOnce();
    expect(cluster.get('Pod', 'agent-42')).toBeUndefined();
    expect(cluster.get('Secret', 'agent-42')).toBeUndefined();
    expect(result.retry).toBe('soon');

    await r.reconcileOnce();
    expect(cluster.get<V1Pod>('Pod', 'agent-42')?.metadata?.labels?.['genia.works/generation']).toBe('7');
    // Secret → PVC → ConfigMap → Pod 순서
    expect(cluster.calls).toEqual([
      'apply Secret/agent-42',
      'apply PersistentVolumeClaim/agent-42-work',
      'apply ConfigMap/agent-42',
      'apply Pod/agent-42',
    ]);
  });

  it('recreateDeletesOnlyPodThenCreatesNextRound', async () => {
    const cluster = new FakeCluster();
    seedRunningAgent(cluster, desiredAgent());
    const works = new FakeWorks(desired([desiredAgent({ generation: 8, applyNow: true })]));
    const r = makeReconciler(cluster, works);

    const first = await r.reconcileOnce();
    expect(cluster.calls).toEqual(['delete Pod/agent-42']);
    expect(first.retry).toBe('wait');

    cluster.finishPodDeletion('agent-42');
    cluster.calls.length = 0;
    await r.reconcileOnce();
    // PVC 는 남아 있어 다시 만들지 않는다, ConfigMap 은 새 generation 으로
    expect(cluster.calls).toEqual(['apply ConfigMap/agent-42', 'apply Pod/agent-42']);
    expect(cluster.get<V1Pod>('Pod', 'agent-42')?.metadata?.labels?.['genia.works/generation']).toBe('8');
    expect(works.issueAgentKey).not.toHaveBeenCalled();
  });

  it('refusesDisallowedImageOnRecreateKeepingRunningPod', async () => {
    const cluster = new FakeCluster();
    seedRunningAgent(cluster, desiredAgent());
    const works = new FakeWorks(desired([desiredAgent({ generation: 8, applyNow: true, image: 'ghcr.io/evil/miner:2' })]));
    const r = makeReconciler(cluster, works);

    await r.reconcileOnce();
    expect(cluster.calls).toEqual([]);
    expect(cluster.get('Pod', 'agent-42')).toBeDefined();
    await r.reportObserved();
    expect(works.reportObserved).toHaveBeenCalledWith([
      expect.objectContaining({ agentUserId: 42, phase: 'FAILED', message: expect.stringContaining('ghcr.io/evil/miner:2') }),
    ], true);
  });

  it('waitsForTerminatingPvcBeforeCreatingAgain', async () => {
    const cluster = new FakeCluster();
    const agent = desiredAgent();
    seedRunningAgent(cluster, agent);
    // 끄자마자 다시 켬 — Pod 는 사라졌고 PVC 는 아직 지워지는 중
    cluster.finishPodDeletion('agent-42');
    const pvc = cluster.get<V1PersistentVolumeClaim>('PersistentVolumeClaim', 'agent-42-work')!;
    pvc.metadata = { ...pvc.metadata, deletionTimestamp: new Date('2026-11-01T01:00:00Z') };
    const works = new FakeWorks(desired([agent]));
    const r = makeReconciler(cluster, works);

    const first = await r.reconcileOnce();
    expect(cluster.get('Pod', 'agent-42')).toBeUndefined();
    expect(first.retry).toBe('wait');

    cluster.objects.delete('PersistentVolumeClaim/agent-42-work');
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toEqual([
      'apply PersistentVolumeClaim/agent-42-work',
      'apply ConfigMap/agent-42',
      'apply Pod/agent-42',
    ]);
  });

  describe('hostPath 작업 디스크(WP-1270)', () => {
    const hostCfg = () => runnerConfig({ workDiskType: 'hostPath' });

    /** hostPath 방식으로 떠 있는 AI — Pod 는 nodeName 노드에 배치됨, Secret 에는 workNode 가 있을 때만 노드 기록. */
    function seedHostPathAgent(cluster: FakeCluster, agent: RunnerDesiredAgent, nodeName: string, workNode?: string) {
      const { pod, configMap } = buildAgentResources(agent, ctx, hostCfg(), { claudeVersion: '57', workNode, repos: REPO_MOUNT });
      cluster.seed({ ...pod, spec: { ...pod.spec!, nodeName } } as V1Pod);
      cluster.seed(configMap);
      cluster.seed(
        buildAgentSecret(
          agent.agentUserId,
          ctx.locationId,
          'agents',
          { 'agent-key': 'ak_old', 'claude-token': 'sk-ant-old', 'repo-github-github.com': 'ghp_old' },
          {
            'genia.works/agent-key-id': '812',
            'genia.works/agent-key-rotate-after': '2026-11-24T01:00:00.000Z',
            'genia.works/claude-version': '57',
            'genia.works/repos-version': REPOS_V,
            'genia.works/repo-hosts': 'GITHUB:github.com',
            ...(workNode ? { 'genia.works/work-node': workNode } : {}),
          },
        ),
      );
    }

    it('recordsScheduledNodeOnSecretOnce', async () => {
      const cluster = new FakeCluster();
      seedHostPathAgent(cluster, desiredAgent(), 'node-a');
      const works = new FakeWorks(desired([desiredAgent()]));
      const r = makeReconciler(cluster, works, [], hostCfg());

      await r.reconcileOnce();
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/work-node']).toBe('node-a');
      // 원문(키·토큰)은 그대로
      expect(decodeSecret(cluster, 'agent-42')['agent-key']).toBe('ak_old');

      // 이미 적었으면 다시 쓰지 않는다
      cluster.calls.length = 0;
      await r.reconcileOnce();
      expect(cluster.calls).toEqual([]);
    });

    it('recreatePinsNewPodToRecordedNodeWithoutPvc', async () => {
      const cluster = new FakeCluster();
      seedHostPathAgent(cluster, desiredAgent(), 'node-a', 'node-a');
      const works = new FakeWorks(desired([desiredAgent({ generation: 8, applyNow: true })]));
      const r = makeReconciler(cluster, works, [], hostCfg());

      await r.reconcileOnce();
      cluster.finishPodDeletion('agent-42');
      cluster.calls.length = 0;
      await r.reconcileOnce();

      expect(cluster.calls).toEqual(['apply ConfigMap/agent-42', 'apply Pod/agent-42']);
      const pod = cluster.get<V1Pod>('Pod', 'agent-42')!;
      expect(pod.spec?.affinity?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms).toEqual([
        { matchFields: [{ key: 'metadata.name', operator: 'In', values: ['node-a'] }] },
      ]);
    });

    it('keepsExistingPvcAfterSwitchingLocationToHostPath', async () => {
      const cluster = new FakeCluster();
      // pvc 방식으로 떠 있던 AI — 위치를 hostPath 로 올린 뒤 generation 이 바뀌어 다시 만든다
      seedRunningAgent(cluster, desiredAgent());
      const works = new FakeWorks(desired([desiredAgent({ generation: 8, applyNow: true })]));
      const r = makeReconciler(cluster, works, [], hostCfg());
      await r.reconcileOnce();
      cluster.finishPodDeletion('agent-42');
      await r.reconcileOnce();

      const pod = cluster.get<V1Pod>('Pod', 'agent-42')!;
      // 끌 때까지는 예전 PVC 를 그대로 쓴다 — 작업 폴더를 잃지 않게
      expect(pod.spec?.volumes?.find((v) => v.name === 'work')?.persistentVolumeClaim?.claimName).toBe('agent-42-work');
      expect(pod.spec?.initContainers).toBeUndefined();
    });

    it('doesNotWaitForTerminatingPvcLeftFromPvcInstall', async () => {
      const cluster = new FakeCluster();
      const agent = desiredAgent();
      // pvc 방식으로 설치했던 위치를 hostPath 로 바꿈 — 옛 PVC 가 지워지는 중이어도 기다리지 않고 띄운다
      seedRunningAgent(cluster, agent);
      cluster.finishPodDeletion('agent-42');
      const pvc = cluster.get<V1PersistentVolumeClaim>('PersistentVolumeClaim', 'agent-42-work')!;
      pvc.metadata = { ...pvc.metadata, deletionTimestamp: new Date('2026-11-01T01:00:00Z') };
      const works = new FakeWorks(desired([agent]));

      await makeReconciler(cluster, works, [], hostCfg()).reconcileOnce();
      expect(cluster.calls).toEqual(['apply ConfigMap/agent-42', 'apply Pod/agent-42']);
      expect(cluster.get<V1Pod>('Pod', 'agent-42')?.spec?.volumes?.find((v) => v.name === 'work')?.hostPath?.path).toBe(
        '/var/lib/genia-agents/agent-42',
      );
    });
  });

  it('keepsPodAndConfigMapWhenApplyNowFalse', async () => {
    const cluster = new FakeCluster();
    seedRunningAgent(cluster, desiredAgent());
    const works = new FakeWorks(desired([desiredAgent({ generation: 8, applyNow: false })]));

    await makeReconciler(cluster, works).reconcileOnce();
    expect(cluster.calls).toEqual([]);
  });

  it('refusesToTakeOverUnlabeledResourceWithSameName', async () => {
    const cluster = new FakeCluster();
    cluster.seed({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'agent-42', namespace: 'agents' } });
    const works = new FakeWorks(desired([desiredAgent()]));
    const r = makeReconciler(cluster, works);

    await r.reconcileOnce();
    expect(cluster.calls).toEqual([]);
    expect(works.issueAgentKey).not.toHaveBeenCalled();
    await r.reportObserved();
    expect(works.reportObserved).toHaveBeenCalledWith([
      expect.objectContaining({ agentUserId: 42, phase: 'FAILED', message: expect.stringContaining('Secret/agent-42') }),
    ], true);
  });

  it('failsNonAnthropicClaudeConnectionButKeepsAgentKey', async () => {
    const cluster = new FakeCluster();
    const works = new FakeWorks(desired([desiredAgent()]));
    works.getClaudeSecret.mockResolvedValue({ version: 57, provider: 'opencode', payload: '{}' });
    const r = makeReconciler(cluster, works);

    await r.reconcileOnce();
    // 받은 AI 키는 Secret 에 남겨 다음 회차에 다시 받지 않는다(받으면 곧 교체)
    expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/agent-key-id']).toBe('942');
    expect(cluster.get('Pod', 'agent-42')).toBeUndefined();
    // 다음 desired 는 받은 키 id(942)를 싣는다
    works.desired = desired([
      desiredAgent({ secrets: [{ name: 'agent-key', source: 'WORKS', version: 942, rotateAfter: null }, desiredAgent().secrets[1]!] }),
    ]);
    await r.reconcileOnce();
    expect(works.issueAgentKey).toHaveBeenCalledTimes(1);

    await r.reportObserved();
    expect(works.reportObserved).toHaveBeenCalledWith([
      expect.objectContaining({ agentUserId: 42, phase: 'FAILED', message: 'Claude Code 템플릿은 Anthropic 연결만 씁니다' }),
    ], true);
  });

  it('applyRejectedReportsFailedWithReason', async () => {
    const cluster = new FakeCluster();
    // 쿼터가 Pod 를 거절한다(dind requests 누락 같은) — 다시 보내도 같은 답
    cluster.rejectApply = (obj) =>
      obj.kind === 'Pod'
        ? new ClusterError('apply', 'Pod', 'agent-42', 403, 'Forbidden', 'pods "agent-42" is forbidden: exceeded quota: agent-runner')
        : undefined;
    const works = new FakeWorks(desired([desiredAgent()]));
    const logs: unknown[] = [];
    const r = makeReconciler(cluster, works, logs);

    const result = await r.reconcileOnce();
    // 거절은 5초마다 두드리지 않고 30초 뒤에 다시
    expect(result.retry).toBe('later');

    await r.reportObserved();
    const sent = works.reportObserved.mock.calls.at(-1)?.[0]?.[0];
    expect(sent).toMatchObject({ agentUserId: 42, phase: 'FAILED' });
    expect(sent?.message).toContain('Pod/agent-42');
    expect(sent?.message).toContain('403');
    expect(sent?.message).toContain('exceeded quota');
    // 원문 비밀값은 사유·로그 어디에도 없다
    expect(JSON.stringify([sent, logs])).not.toContain('ak_plain_42');

    // 쿼터가 풀리면(일시 오류 회복) 다음 회차에 만들고 FAILED 를 지운다
    cluster.rejectApply = undefined;
    const ok = await r.reconcileOnce();
    expect(ok.retry).toBeUndefined();
    expect(cluster.get('Pod', 'agent-42')).toBeDefined();
    await r.reportObserved();
    expect(works.reportObserved.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ agentUserId: 42, phase: 'STARTING', message: null });
  });

  it('transientApplyErrorRetriesSoonWithoutFailed', async () => {
    const cluster = new FakeCluster();
    cluster.rejectApply = (obj) => (obj.kind === 'Pod' ? new ClusterError('apply', 'Pod', 'agent-42', 503) : undefined);
    const works = new FakeWorks(desired([desiredAgent()]));
    const r = makeReconciler(cluster, works);

    const result = await r.reconcileOnce();
    expect(result.retry).toBe('soon');
    await r.reportObserved();
    expect(works.reportObserved.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ agentUserId: 42, phase: 'STARTING' });
  });

  it('recreatesPodWhenClaudeVersionChanges', async () => {
    const cluster = new FakeCluster();
    seedRunningAgent(cluster, desiredAgent());
    // 관리자가 모델 연결을 다시 등록 — generation 은 그대로, applyNow=false 라도 바로 다시 만든다(옛 토큰은 대개 끊겼다)
    const agent = desiredAgent({
      applyNow: false,
      secrets: [desiredAgent().secrets[0]!, { name: 'claude', source: 'WORKS', version: 58, rotateAfter: null }],
    });
    const works = new FakeWorks(desired([agent]));
    works.getClaudeSecret.mockResolvedValue({ version: 58, provider: 'anthropic', payload: 'sk-ant-new' });
    const r = makeReconciler(cluster, works);

    const first = await r.reconcileOnce();
    expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
    expect(first.retry).toBe('wait');

    cluster.finishPodDeletion('agent-42');
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toEqual(['apply ConfigMap/agent-42', 'apply Pod/agent-42']);
    expect(cluster.get<V1Pod>('Pod', 'agent-42')?.metadata?.annotations?.['genia.works/claude-version']).toBe('58');
    expect(works.issueAgentKey).not.toHaveBeenCalled();

    // 연결을 지움(값 → null)도 바뀐 것이다
    works.desired = desired([desiredAgent({ secrets: [desiredAgent().secrets[0]!, { name: 'claude', source: 'WORKS', version: null, rotateAfter: null }] })]);
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
  });

  it('keepsPodWhenClaudeVersionSame', async () => {
    const cluster = new FakeCluster();
    seedRunningAgent(cluster, desiredAgent());
    // generation 도 달라졌지만 applyNow=false — 연결이 같으면 하던 일을 마치게 둔다
    const works = new FakeWorks(desired([desiredAgent({ generation: 8, applyNow: false })]));

    await makeReconciler(cluster, works).reconcileOnce();
    expect(cluster.calls).toEqual([]);
    expect(works.getClaudeSecret).not.toHaveBeenCalled();
  });

  describe('미뤄 둔 generation 과 모델 연결 교체(WP-1515)', () => {
    // 사람이 AI 계정을 바꾸면 Works 가 generation 을 올리고(apply_mode IDLE) 모델 연결 version 도 바뀐다.
    // 일하는 중(applyNow=false)이면 Pod 는 그 generation 과 함께 쉴 때 가고, Secret 만 새 값으로 먼저 고친다.
    const claude58 = (overrides: Partial<RunnerDesiredAgent> = {}) =>
      desiredAgent({
        secrets: [desiredAgent().secrets[0]!, { name: 'claude', source: 'WORKS', version: 58, rotateAfter: null }],
        ...overrides,
      });

    it('deletesPodWhenGenerationSameAndClaudeVersionChanges', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      // 키 교체(원문 교체) — generation 은 그대로라 applyNow 와 무관하게 바로 다시 만든다(기존 동작)
      const works = new FakeWorks(desired([claude58({ applyNow: false })]));
      works.getClaudeSecret.mockResolvedValue({ version: 58, provider: 'anthropic', payload: 'sk-ant-new' });

      await makeReconciler(cluster, works).reconcileOnce();
      expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
    });

    it('keepsPodButUpdatesSecretWhenGenerationPendingAndApplyNowFalse', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      // Pod 는 generation 7, desired 는 8 — 사람이 계정을 바꿨고 AI 는 일하는 중
      const works = new FakeWorks(desired([claude58({ generation: 8, applyNow: false })]));
      works.getClaudeSecret.mockResolvedValue({ version: 58, provider: 'anthropic', payload: 'sk-ant-new' });

      await makeReconciler(cluster, works).reconcileOnce();
      expect(cluster.calls).toEqual(['apply Secret/agent-42']);
      expect(cluster.get<V1Pod>('Pod', 'agent-42')?.metadata?.labels?.['genia.works/generation']).toBe('7');
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/claude-version']).toBe('58');
      expect(decodeSecret(cluster, 'agent-42')['claude-token']).toBe('sk-ant-new');
    });

    it('keepsPodWithoutGenerationLabelWhenApplyNowFalse', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      // generation 라벨이 없는 옛 Pod — plan.ts 처럼 다른 generation 으로 보아 applyNow 규칙을 따른다
      delete cluster.get<V1Pod>('Pod', 'agent-42')!.metadata!.labels!['genia.works/generation'];
      const works = new FakeWorks(desired([claude58({ applyNow: false })]));
      works.getClaudeSecret.mockResolvedValue({ version: 58, provider: 'anthropic', payload: 'sk-ant-new' });

      await makeReconciler(cluster, works).reconcileOnce();
      expect(cluster.calls).toEqual(['apply Secret/agent-42']);
    });

    it('recreatesPodWhenGenerationPendingAndApplyNowTrue', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      // 쉬는 때가 됨(applyNow=true) — 미뤄 둔 generation 과 새 계정이 함께 적용된다
      const works = new FakeWorks(desired([claude58({ generation: 8, applyNow: true })]));
      works.getClaudeSecret.mockResolvedValue({ version: 58, provider: 'anthropic', payload: 'sk-ant-new' });
      const r = makeReconciler(cluster, works);

      await r.reconcileOnce();
      expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);

      cluster.finishPodDeletion('agent-42');
      cluster.calls.length = 0;
      await r.reconcileOnce();
      expect(cluster.calls).toEqual(['apply ConfigMap/agent-42', 'apply Pod/agent-42']);
      const pod = cluster.get<V1Pod>('Pod', 'agent-42');
      expect(pod?.metadata?.labels?.['genia.works/generation']).toBe('8');
      expect(pod?.metadata?.annotations?.['genia.works/claude-version']).toBe('58');
    });
  });

  describe('로그인 정보(WP-1296)', () => {
    const LOGIN_PAYLOAD = '{"tokens":{"access_token":"fake-login-secret-value"}}';
    /** 기본 AI(claude·repos 는 seed 와 같아 안 흔들림)에 login 참조를 더한 AI. */
    const loginAgent = (version: number | null | 'none') =>
      desiredAgent({
        secrets: [
          ...desiredAgent().secrets,
          ...(version === 'none' ? [] : [{ name: 'login', source: 'WORKS' as const, version, rotateAfter: null }]),
        ],
      });
    const withLoginSecret = (works: FakeWorks, version = 88) =>
      works.getLoginSecret.mockResolvedValue({ version, provider: 'genia', payload: LOGIN_PAYLOAD });

    it('fetchesLoginForNewAgentAndStoresKeyAnnotationAndPodMount', async () => {
      const cluster = new FakeCluster();
      const logs: unknown[] = [];
      const agent = desiredAgent({
        secrets: [
          { name: 'agent-key', source: 'WORKS', version: null, rotateAfter: null },
          { name: 'login', source: 'WORKS', version: 88, rotateAfter: null },
        ],
      });
      const works = new FakeWorks(desired([agent]));
      withLoginSecret(works);
      await makeReconciler(cluster, works, logs).reconcileOnce();

      expect(works.getLoginSecret).toHaveBeenCalledWith(42);
      // claude 참조가 없으니 모델 연결은 건드리지 않는다(provider 검사도 없다)
      expect(works.getClaudeSecret).not.toHaveBeenCalled();
      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBe(LOGIN_PAYLOAD);
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/login-version']).toBe('88');
      const pod = cluster.get<V1Pod>('Pod', 'agent-42')!;
      expect(pod.metadata?.annotations?.['genia.works/login-version']).toBe('88');
      const agentContainer = pod.spec?.containers.find((c) => c.name === 'agent');
      expect(agentContainer?.volumeMounts).toContainEqual({ name: 'agent-secret', mountPath: '/run/genia/login-info', subPath: 'login-info', readOnly: true });
      expect(agentContainer?.env).toContainEqual({ name: 'GENIA_LOGIN_VERSION', value: '88' });
      // 원문은 어떤 로그에도 남지 않는다
      expect(JSON.stringify(logs)).not.toContain('fake-login-secret-value');
    });

    it('clearsLoginKeyAndAnnotationWhenServerReturnsNotFound', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, loginAgent(89), ctx.locationId, '88');
      // 받으러 간 사이 연결이 없어짐(404 → null) — 지우고, 값 → 없음 이라 Pod 도 다시 만든다
      const works = new FakeWorks(desired([loginAgent(89)]));
      works.getLoginSecret.mockResolvedValue(null);
      await makeReconciler(cluster, works).reconcileOnce();

      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBeUndefined();
      // desired 의 버전은 적어 둔다 — desired 가 다시 바뀔 때까지 회차마다 다시 받으러 가지 않게
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/login-version']).toBe('89');
      expect(cluster.calls).toContain('delete Pod/agent-42');

      // 다음 회차(옛 Pod 가 사라진 뒤) — 다시 받지 않고, 새 Pod 에는 로그인 정보를 꽂지 않는다
      cluster.instantPodDelete = true;
      await cluster.delete('Pod', 'agent-42');
      works.getLoginSecret.mockClear();
      await makeReconciler(cluster, works).reconcileOnce();
      expect(works.getLoginSecret).not.toHaveBeenCalled();
      const pod = cluster.get<V1Pod>('Pod', 'agent-42');
      expect(pod?.metadata?.deletionTimestamp).toBeUndefined();
      expect(pod).toBeDefined();
      expect(pod?.metadata?.annotations?.['genia.works/login-version']).toBeUndefined();
      expect(JSON.stringify(pod?.spec)).not.toContain('login-info');
    });

    it('recreatesRunningPodWhenLoginVersionChanges', async () => {
      const cluster = new FakeCluster();
      const logs: unknown[] = [];
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      // 관리자가 로그인 정보를 다시 등록 — generation 은 그대로, applyNow=false 라도 바로 다시 만든다
      const agent = { ...loginAgent(89), applyNow: false };
      const works = new FakeWorks(desired([agent]));
      withLoginSecret(works, 89);
      const r = makeReconciler(cluster, works, logs);

      const first = await r.reconcileOnce();
      expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
      expect(first.retry).toBe('wait');
      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBe(LOGIN_PAYLOAD);

      cluster.finishPodDeletion('agent-42');
      cluster.calls.length = 0;
      await r.reconcileOnce();
      expect(cluster.calls).toEqual(['apply ConfigMap/agent-42', 'apply Pod/agent-42']);
      expect(cluster.get<V1Pod>('Pod', 'agent-42')?.metadata?.annotations?.['genia.works/login-version']).toBe('89');
      expect(works.issueAgentKey).not.toHaveBeenCalled();
      expect(JSON.stringify(logs)).not.toContain('fake-login-secret-value');
    });

    it('refreshesOnlySecretWhenOnlyLoginRevisionChanges', async () => {
      const cluster = new FakeCluster();
      const logs: unknown[] = [];
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      // 옛 Secret 은 revision 3 으로 기록 — 서버가 갱신해 4 가 됨(loginVersion 은 그대로)
      const seeded = cluster.get<V1Secret>('Secret', 'agent-42')!;
      seeded.metadata!.annotations!['genia.works/login-revision'] = '3';
      const agent = { ...loginAgent(88), loginRevision: 4 };
      const works = new FakeWorks(desired([agent]));
      withLoginSecret(works, 88);
      await makeReconciler(cluster, works, logs).reconcileOnce();

      expect(works.getLoginSecret).toHaveBeenCalledWith(42);
      expect(cluster.calls).toEqual(['apply Secret/agent-42']);
      expect(cluster.calls).not.toContain('delete Pod/agent-42');
      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBe(LOGIN_PAYLOAD);
      const ann = cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations;
      expect(ann?.['genia.works/login-revision']).toBe('4');
      expect(ann?.['genia.works/login-version']).toBe('88');
      expect(JSON.stringify(logs)).not.toContain('fake-login-secret-value');

      // 다음 회차 — revision 이 같으니 다시 받지 않는다
      works.getLoginSecret.mockClear();
      cluster.calls.length = 0;
      await makeReconciler(cluster, works, logs).reconcileOnce();
      expect(works.getLoginSecret).not.toHaveBeenCalled();
      expect(cluster.calls).toEqual([]);
    });

    it('keepsLoginAndPodWhenRevisionOnlyRefetchReturnsNotFound', async () => {
      const cluster = new FakeCluster();
      const logs: unknown[] = [];
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      const seeded = cluster.get<V1Secret>('Secret', 'agent-42')!;
      seeded.metadata!.annotations!['genia.works/login-revision'] = '3';
      // version 은 그대로, revision 만 오름 — 그런데 받으러 가니 404(복호화 실패·일시 불일치)
      const agent = { ...loginAgent(88), loginRevision: 4 };
      const works = new FakeWorks(desired([agent]));
      works.getLoginSecret.mockResolvedValue(null);
      await makeReconciler(cluster, works, logs).reconcileOnce();

      // 옛 로그인 정보·version·revision 은 그대로 두고 Pod 도 건드리지 않는다(경고만 남긴다)
      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBe('{"old":true}');
      const ann = cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations;
      expect(ann?.['genia.works/login-version']).toBe('88');
      expect(ann?.['genia.works/login-revision']).toBe('3');
      expect(cluster.calls).not.toContain('delete Pod/agent-42');
      expect(cluster.calls).toEqual([]);
      expect(JSON.stringify(logs)).toContain('로그인 정보를 다시 받지 못해');

      // 다음 회차 — revision 기록이 그대로라 다시 받으러 가고, 이번엔 받으면 Secret 만 바꾼다
      withLoginSecret(works, 88);
      works.getLoginSecret.mockClear();
      await makeReconciler(cluster, works, logs).reconcileOnce();
      expect(works.getLoginSecret).toHaveBeenCalledWith(42);
      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBe(LOGIN_PAYLOAD);
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/login-revision']).toBe('4');
      expect(cluster.calls).not.toContain('delete Pod/agent-42');
    });

    it('recreatesPodWhenLoginVersionChangesEvenWithRevision', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      const agent = { ...loginAgent(89), loginRevision: 1 };
      const works = new FakeWorks(desired([agent]));
      withLoginSecret(works, 89);
      await makeReconciler(cluster, works).reconcileOnce();

      expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/login-revision']).toBe('1');
    });

    it('recreatesPodWhenLoginVersionBecomesNull', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      // 연결이 지워지거나 템플릿 계정과 다른 종류로 바뀜(version null) — 받을 것이 없고 값 → 없음 이라 다시 만든다
      const works = new FakeWorks(desired([loginAgent(null)]));
      await makeReconciler(cluster, works).reconcileOnce();

      expect(works.getLoginSecret).not.toHaveBeenCalled();
      expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBeUndefined();
    });

    it('recreatesPodWhenLoginAppearsOnPodWithoutIt', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, loginAgent('none'));
      // 없음 → 값
      const works = new FakeWorks(desired([loginAgent(88)]));
      withLoginSecret(works);
      await makeReconciler(cluster, works).reconcileOnce();
      expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
    });

    it('keepsPodWhenLoginVersionSame', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      const works = new FakeWorks(desired([loginAgent(88)]));
      await makeReconciler(cluster, works).reconcileOnce();
      expect(cluster.calls).toEqual([]);
      expect(works.getLoginSecret).not.toHaveBeenCalled();
    });

    it('keepsOldLoginAndStillWritesAgentKeyWhenFetchFails', async () => {
      const cluster = new FakeCluster();
      const logs: unknown[] = [];
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      const agent = { ...loginAgent(89), secrets: [{ ...loginAgent(89).secrets[0]!, version: null }, ...loginAgent(89).secrets.slice(1)] };
      const works = new FakeWorks(desired([agent]));
      works.getLoginSecret.mockRejectedValue(new Error('boom'));
      await makeReconciler(cluster, works, logs).reconcileOnce();

      // 새 AI 키는 적고(받으면 곧 교체라 다시 받지 않게), 옛 로그인 정보·Pod 는 그대로
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/agent-key-id']).toBe('942');
      expect(decodeSecret(cluster, 'agent-42')['login-info']).toBe('{"old":true}');
      expect(cluster.calls).not.toContain('delete Pod/agent-42');
    });

    it('doesNotRecreateForLoginChangeWhenImageNowDisallowed', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, loginAgent(88), ctx.locationId, '88');
      const works = new FakeWorks(desired([{ ...loginAgent(89), image: 'ghcr.io/evil/miner:3' }]));
      withLoginSecret(works, 89);
      await makeReconciler(cluster, works).reconcileOnce();
      expect(cluster.calls).not.toContain('delete Pod/agent-42');
    });
  });

  describe('저장소 토큰(WP-1268)', () => {
    const withRepos = (agent: RunnerDesiredAgent, version: number | null | 'none') => ({
      ...agent,
      secrets: [
        ...agent.secrets.filter((x) => x.name !== 'repos'),
        ...(version === 'none' ? [] : [{ name: 'repos', source: 'WORKS' as const, version, rotateAfter: null }]),
      ],
    });
    /** agent-key·claude 는 이미 받은 상태로 둔 새 AI(repos 만 아직) — 키 교체 호출이 섞이지 않게. */
    const freshAgent = (id = 42) =>
      desiredAgent({
        agentUserId: id,
        secrets: [
          { name: 'agent-key', source: 'WORKS', version: null, rotateAfter: null },
          { name: 'claude', source: 'WORKS', version: 57, rotateAfter: null },
          { name: 'repos', source: 'WORKS', version: 1730505600000, rotateAfter: null },
        ],
      });

    it('fetchesReposForNewAgentAndWritesKeysAnnotationsAndPodVolume', async () => {
      const cluster = new FakeCluster();
      const works = new FakeWorks(desired([freshAgent()]));
      works.getRepoSecrets.mockResolvedValue({
        version: 1730505600000,
        tokens: [
          { kind: 'GITHUB', host: 'github.com', token: 'ghp_aaaaaaaaaaaaaaaa' },
          { kind: 'GITLAB', host: 'gitlab.iacloud.kr', token: 'glpat_bbbbbbbbbbbbbbbb' },
        ],
      });
      await makeReconciler(cluster, works).reconcileOnce();

      expect(decodeSecret(cluster, 'agent-42')).toMatchObject({
        'repo-github-github.com': 'ghp_aaaaaaaaaaaaaaaa',
        'repo-gitlab-gitlab.iacloud.kr': 'glpat_bbbbbbbbbbbbbbbb',
      });
      const ann = cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations;
      expect(ann?.['genia.works/repos-version']).toBe('1730505600000');
      expect(ann?.['genia.works/repo-hosts']).toBe('GITHUB:github.com,GITLAB:gitlab.iacloud.kr');
      const pod = cluster.get<V1Pod>('Pod', 'agent-42');
      expect(pod?.metadata?.annotations?.['genia.works/repos-version']).toBe('1730505600000');
      expect(pod?.spec?.volumes?.find((v) => v.name === 'repo-tokens')?.secret?.items).toEqual([
        { key: 'repo-github-github.com', path: 'github/github.com' },
        { key: 'repo-gitlab-gitlab.iacloud.kr', path: 'gitlab/gitlab.iacloud.kr' },
      ]);
    });

    it('doesNotRefetchReposWhenVersionSameEvenAfterRunnerRestart', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      const works = new FakeWorks(desired([desiredAgent()]));
      await makeReconciler(cluster, works).reconcileOnce();
      await makeReconciler(cluster, works).reconcileOnce();
      expect(works.getRepoSecrets).not.toHaveBeenCalled();
      expect(cluster.calls).toEqual([]);
    });

    it('refetchesReposAndRecreatesPodWhenVersionChanges', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      // 토큰 교체 — generation 은 그대로, applyNow=false 라도 gh 로그인을 새로 하려면 Pod 를 다시 만들어야 한다
      const works = new FakeWorks(desired([withRepos(desiredAgent({ applyNow: false }), 1730509999999)]));
      works.getRepoSecrets.mockResolvedValue({
        version: 1730509999999,
        tokens: [{ kind: 'GITHUB', host: 'ghe.example.com', token: 'ghp_newnewnewnewnew1' }],
      });
      const r = makeReconciler(cluster, works);

      const first = await r.reconcileOnce();
      expect(works.getRepoSecrets).toHaveBeenCalledTimes(1);
      expect(cluster.calls).toEqual(['apply Secret/agent-42', 'delete Pod/agent-42']);
      expect(first.retry).toBe('wait');
      // 빠진 host(github.com)의 키는 지운다
      const data = decodeSecret(cluster, 'agent-42');
      expect(data['repo-github-ghe.example.com']).toBe('ghp_newnewnewnewnew1');
      expect(data['repo-github-github.com']).toBeUndefined();

      cluster.finishPodDeletion('agent-42');
      cluster.calls.length = 0;
      await r.reconcileOnce();
      expect(cluster.calls).toEqual(['apply ConfigMap/agent-42', 'apply Pod/agent-42']);
      expect(cluster.get<V1Pod>('Pod', 'agent-42')?.metadata?.annotations?.['genia.works/repos-version']).toBe('1730509999999');
    });

    it.each([
      ['refGone', 'none'],
      ['versionNull', null],
    ] as const)('clearsRepoKeysAndAnnotationsWhen_%s', async (_name, version) => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      const works = new FakeWorks(desired([withRepos(desiredAgent(), version)]));
      await makeReconciler(cluster, works).reconcileOnce();

      expect(works.getRepoSecrets).not.toHaveBeenCalled();
      expect(Object.keys(decodeSecret(cluster, 'agent-42')).filter((k) => k.startsWith('repo-'))).toEqual([]);
      const ann = cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations ?? {};
      expect(ann['genia.works/repos-version']).toBeUndefined();
      expect(ann['genia.works/repo-hosts']).toBeUndefined();
      // 토큰이 사라졌으니 Pod 도 다시 만든다(gh 로그인 제거)
      expect(cluster.calls).toContain('delete Pod/agent-42');
    });

    it('recordsDesiredVersionWhenTokensVanishedBeforeFetch_soItDoesNotRefetchEveryRound', async () => {
      const cluster = new FakeCluster();
      seedRunningAgent(cluster, desiredAgent());
      // desired 는 버전 99 를 냈지만 받으러 간 사이 모두 폐기됨 — 응답은 version null
      const works = new FakeWorks(desired([withRepos(desiredAgent(), 99)]));
      works.getRepoSecrets.mockResolvedValue({ version: null, tokens: [] });
      const r = makeReconciler(cluster, works);
      await r.reconcileOnce();
      await r.reconcileOnce();

      expect(works.getRepoSecrets).toHaveBeenCalledTimes(1);
      expect(cluster.get<V1Secret>('Secret', 'agent-42')?.metadata?.annotations?.['genia.works/repos-version']).toBe('99');
    });

    it('givesEachAgentItsOwnTokens', async () => {
      const cluster = new FakeCluster();
      const works = new FakeWorks(desired([freshAgent(42), freshAgent(43)]));
      works.getRepoSecrets.mockImplementation(async (id: number) => ({
        version: 1730505600000,
        tokens: [{ kind: 'GITHUB' as const, host: 'github.com', token: `ghp_agent${id}_xxxxxxxxxxxx` }],
      }));
      await makeReconciler(cluster, works).reconcileOnce();
      expect(decodeSecret(cluster, 'agent-42')['repo-github-github.com']).toBe('ghp_agent42_xxxxxxxxxxxx');
      expect(decodeSecret(cluster, 'agent-43')['repo-github-github.com']).toBe('ghp_agent43_xxxxxxxxxxxx');
    });

    it('neverLogsTokenPlaintext', async () => {
      const cluster = new FakeCluster();
      const logs: unknown[] = [];
      const works = new FakeWorks(desired([freshAgent()]));
      works.getRepoSecrets.mockResolvedValue({
        version: 1730505600000,
        tokens: [{ kind: 'GITHUB', host: 'github.com', token: 'ghp_SECRETSECRETSECRET' }],
      });
      await makeReconciler(cluster, works, logs).reconcileOnce();
      expect(JSON.stringify(logs)).not.toContain('ghp_SECRETSECRETSECRET');
    });

    it('createsNoPodWhenReposFetchFailsForNewAgent', async () => {
      const cluster = new FakeCluster();
      const works = new FakeWorks(desired([freshAgent()]));
      works.getRepoSecrets.mockRejectedValue(new Error('boom'));
      const r = await makeReconciler(cluster, works).reconcileOnce();
      expect(cluster.get('Pod', 'agent-42')).toBeUndefined();
      expect(r.retry).toBeDefined();
    });
  });

  it('doesNotRecreateForClaudeChangeWhenImageNowDisallowed', async () => {
    const cluster = new FakeCluster();
    seedRunningAgent(cluster, desiredAgent());
    const agent = desiredAgent({
      image: 'ghcr.io/evil/miner:3',
      secrets: [desiredAgent().secrets[0]!, { name: 'claude', source: 'WORKS', version: 58, rotateAfter: null }],
    });
    const works = new FakeWorks(desired([agent]));
    await makeReconciler(cluster, works).reconcileOnce();
    // 지웠다가 다시 못 만드는 일이 없게 — 멀쩡한 Pod 를 그대로 둔다
    expect(cluster.calls).not.toContain('delete Pod/agent-42');
  });

  it('ignoresResourcesOfOtherLocationInSameNamespace', async () => {
    const cluster = new FakeCluster();
    // 같은 네임스페이스에 위치 9 의 runner 가 만든 AI 50 과 AI 42 가 있다
    seedRunningAgent(cluster, desiredAgent({ agentUserId: 50 }), 9);
    seedRunningAgent(cluster, desiredAgent({ agentUserId: 42 }), 9);
    // 이 runner(위치 3)는 50 을 모르고, 42 를 띄우려 한다
    const works = new FakeWorks(desired([desiredAgent({ agentUserId: 42 })]));
    const r = makeReconciler(cluster, works);

    await r.reconcileOnce();
    // 남의 위치 리소스는 지우지도 덮어쓰지도 않는다
    expect(cluster.calls).toEqual([]);
    expect(works.issueAgentKey).not.toHaveBeenCalled();
    expect(cluster.objects.size).toBe(8);

    await r.reportObserved();
    // 50 은 보고에 없고, 42 는 이름 충돌로 FAILED
    expect(works.reportObserved.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ agentUserId: 42, phase: 'FAILED', message: expect.stringContaining('agent-42') }),
    ]);
  });

  it('batchesStoppedReportsOncePerRound', async () => {
    const cluster = new FakeCluster();
    cluster.instantPodDelete = true;
    for (const id of [3, 1, 2]) seedRunningAgent(cluster, desiredAgent({ agentUserId: id }));
    const works = new FakeWorks(desired([]));
    const r = makeReconciler(cluster, works);

    // 1회차 — 세 AI 의 Pod·PVC·Secret 을 지운다(Pod 는 바로 사라짐), STOPPED 는 아직 보내지 않는다
    await r.reconcileOnce();
    expect(works.reportObserved).not.toHaveBeenCalled();

    // 2회차 — STOPPED 셋을 한 번에(id 순) 보내고 ConfigMap 을 모두 지운다
    const second = await r.reconcileOnce();
    expect(works.reportObserved).toHaveBeenCalledTimes(1);
    expect(works.reportObserved.mock.calls[0]?.[0]?.map((a) => [a.agentUserId, a.phase])).toEqual([
      [1, 'STOPPED'],
      [2, 'STOPPED'],
      [3, 'STOPPED'],
    ]);
    expect(cluster.objects.size).toBe(0);
    expect(second.retry).toBeUndefined();
  });

  it('doesNotRepeatStoppedWhilePvcTerminating', async () => {
    const cluster = new FakeCluster();
    cluster.lingeringPvcDelete = true;
    seedRunningAgent(cluster, desiredAgent());
    const works = new FakeWorks(desired([]));
    const r = makeReconciler(cluster, works);

    // 1회차 — Pod·PVC·Secret 삭제(Pod·PVC 는 지우는 중이 된다)
    await r.reconcileOnce();
    // Pod 가 지워지는 동안 PVC·Secret 삭제를 다시 내지 않는다
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toEqual([]);

    // Pod 가 사라짐 — STOPPED 를 한 번 보내고 ConfigMap 을 지운다
    cluster.finishPodDeletion('agent-42');
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toEqual(['delete ConfigMap/agent-42']);
    expect(works.reportObserved).toHaveBeenCalledTimes(1);

    // PVC 는 아직 Terminating — 삭제도 STOPPED 도 다시 보내지 않는다
    cluster.calls.length = 0;
    await r.reconcileOnce();
    await r.reconcileOnce();
    expect(cluster.calls).toEqual([]);
    expect(works.reportObserved).toHaveBeenCalledTimes(1);
  });

  it('reportsObservedForDesiredAndStoppingAgentsWithMetrics', async () => {
    const cluster = new FakeCluster();
    const running = desiredAgent({ agentUserId: 1 });
    seedRunningAgent(cluster, running);
    seedRunningAgent(cluster, desiredAgent({ agentUserId: 2 }));
    cluster.metrics.set('agent-1', { cpuMillicores: 1200, memoryBytes: 3221225472 });
    const works = new FakeWorks(desired([running]));
    const r = makeReconciler(cluster, works);
    await r.reconcileOnce(); // 2 는 지우는 중이 된다

    await r.reportObserved();
    const sent = works.reportObserved.mock.calls.at(-1)?.[0] ?? [];
    expect(sent).toEqual([
      expect.objectContaining({ agentUserId: 1, observedGeneration: 7, phase: 'STARTING', cpuMillicores: 1200, memoryBytes: 3221225472 }),
      expect.objectContaining({ agentUserId: 2, phase: 'STOPPING' }),
    ]);

    // 조회되면 사용량을 잴 수 있다고 함께 보낸다
    expect(works.reportObserved.mock.calls.at(-1)?.[1]).toBe(true);

    // 일시 오류여도 보고는 나가고, 잴 수 있는지는 모름(보내지 않음)
    cluster.failMetrics = true;
    await r.reportObserved();
    expect(works.reportObserved.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ agentUserId: 1, cpuMillicores: null });
    expect(works.reportObserved.mock.calls.at(-1)?.[1]).toBeUndefined();
  });

  it('reportsMetricsUnavailableWhenMetricsApiMissing', async () => {
    const cluster = new FakeCluster();
    cluster.missingMetricsApi = true;
    const works = new FakeWorks(desired([]));
    const r = makeReconciler(cluster, works);
    await r.reconcileOnce();
    await r.reportObserved();
    // AI 가 없어도 위치의 「잴 수 없음」은 알린다
    expect(works.reportObserved).toHaveBeenCalledWith([], false);
  });

  it('sendsEmptyObservedListToStayConnected', async () => {
    const cluster = new FakeCluster();
    const works = new FakeWorks(desired([]));
    const r = makeReconciler(cluster, works);
    await r.reconcileOnce();
    await r.reportObserved();
    expect(works.reportObserved).toHaveBeenCalledWith([], true);
  });
});

describe('클러스터 다시 보기(WP-1501)', () => {
  /** 떠 있는 AI 하나와, 한 회차를 돌려 마지막 desired 를 들고 있는 reconciler. Works 호출 수를 세려고 getDesired 를 엿본다. */
  async function runningSetup(overrides: Partial<RunnerDesiredAgent> = {}) {
    const cluster = new FakeCluster();
    const agent = desiredAgent(overrides);
    seedRunningAgent(cluster, agent);
    const works = new FakeWorks(desired([agent]));
    const getDesired = vi.spyOn(works, 'getDesired');
    const r = makeReconciler(cluster, works);
    await r.reconcileOnce();
    cluster.calls.length = 0;
    return { cluster, works, getDesired, r, podName: `agent-${agent.agentUserId}` };
  }

  it('recreatesPodDeletedOutsideRunnerOnNextReconcile', async () => {
    const { cluster, works, getDesired, r, podName } = await runningSetup();
    expect(await r.clusterNeedsReconcile()).toBe(false);

    // kubectl delete pod — 지우는 중인 동안은 기다리고(깨우지 않음), 사라지면 깨운다
    await cluster.delete('Pod', podName);
    expect(await r.clusterNeedsReconcile()).toBe(false);
    cluster.finishPodDeletion(podName);
    expect(await r.clusterNeedsReconcile()).toBe(true);
    // 다시 보기는 Works 를 부르지 않는다 — 오래된 desired 로 키를 다시 받는(=교체) 일이 없게
    expect(getDesired).toHaveBeenCalledTimes(1);
    expect(works.issueAgentKey).not.toHaveBeenCalled();

    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toContain(`apply Pod/${podName}`);
    expect(works.issueAgentKey).not.toHaveBeenCalled();
    expect(await r.clusterNeedsReconcile()).toBe(false);
  });

  it('recreatesCompletedPodOnNextReconcile', async () => {
    const { cluster, works, getDesired, r, podName } = await runningSetup();

    // 노드 재시작 뒤 Completed 로 남은 맨 Pod
    cluster.get<V1Pod>('Pod', podName)!.status = { phase: 'Succeeded' };
    expect(await r.clusterNeedsReconcile()).toBe(true);
    expect(getDesired).toHaveBeenCalledTimes(1);

    // 첫 회차는 끝난 Pod 를 지우고(15초 뒤 다시 봄), 사라진 뒤 회차가 새로 만든다
    const first = await r.reconcileOnce();
    expect(cluster.calls).toEqual([`delete Pod/${podName}`]);
    expect(first.retry).toBe('wait');
    cluster.finishPodDeletion(podName);
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toContain(`apply Pod/${podName}`);
    expect(cluster.get<V1Pod>('Pod', podName)?.status).toBeUndefined();
    expect(works.issueAgentKey).not.toHaveBeenCalled();
  });

  it('recreatesErroredPodEvenWhenApplyNowFalse', async () => {
    const { cluster, r, podName } = await runningSetup({ applyNow: false });
    cluster.instantPodDelete = true;
    cluster.get<V1Pod>('Pod', podName)!.status = { phase: 'Failed', reason: 'Terminated' };
    expect(await r.clusterNeedsReconcile()).toBe(true);
    await r.reconcileOnce();
    await r.reconcileOnce();
    expect(cluster.calls).toEqual([`delete Pod/${podName}`, `apply ConfigMap/${podName}`, `apply Pod/${podName}`]);
  });

  it('listsOnlyPodsForCheck', async () => {
    const { cluster, r } = await runningSetup();
    cluster.lists.length = 0;
    await r.clusterNeedsReconcile();
    expect(cluster.lists).toEqual(['pods']);
  });

  it('wakesForDeletedPodEvenWithUnrelatedFailure', async () => {
    // 클러스터가 Secret 갱신을 거절함(쿼터·검증 등 — 저절로 나을 수 있는 실패) — 그 AI 의 Pod 가 지워지면 여전히 조정을 깨운다
    const { cluster, works, r, podName } = await runningSetup();
    works.getClaudeSecret.mockImplementation(async () => ({ version: 58, provider: 'anthropic', payload: 'sk-ant-new' }));
    works.desired = desired([
      desiredAgent({
        secrets: desiredAgent().secrets.map((ref) => (ref.name === 'claude' ? { ...ref, version: 58 } : ref)),
      }),
    ]);
    cluster.rejectApply = (obj) =>
      obj.kind === 'Secret' ? new ClusterError('apply', 'Secret', obj.metadata?.name ?? '', 403, 'Forbidden') : undefined;
    expect((await r.reconcileOnce()).retry).toBe('later');
    await r.reportObserved();
    expect(works.reportObserved.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ phase: 'FAILED' });

    cluster.instantPodDelete = true;
    await cluster.delete('Pod', podName);
    expect(await r.clusterNeedsReconcile()).toBe(true);
  });

  it('doesNotWakeBeforeDesiredOrForFailedAgent', async () => {
    const cluster = new FakeCluster();
    // 허용 밖 이미지 — Works 쪽이 바뀌어야 낫는다. Pod 가 없어도 간격마다 깨우지 않는다
    const agent = desiredAgent({ image: 'ghcr.io/evil/agent:1' });
    const r = makeReconciler(cluster, new FakeWorks(desired([agent])));
    expect(await r.clusterNeedsReconcile()).toBe(false);
    await r.reconcileOnce();
    expect(cluster.get('Pod', `agent-${agent.agentUserId}`)).toBeUndefined();
    expect(await r.clusterNeedsReconcile()).toBe(false);
  });
});

describe('계속 끝나는 Pod 의 간격·사유 보고(WP-1501)', () => {
  /** 시계를 움직일 수 있는 reconciler 와 떠 있는 AI 하나. Pod 삭제는 바로 끝난다(지우기 회차 → 만들기 회차). */
  async function loopSetup(overrides: Partial<RunnerDesiredAgent> = {}) {
    const cluster = new FakeCluster();
    cluster.instantPodDelete = true;
    const agent = desiredAgent(overrides);
    seedRunningAgent(cluster, agent);
    const works = new FakeWorks(desired([agent]));
    const logs: unknown[][] = [];
    const clock = { t: NOW.getTime() };
    const log = {
      info: (...a: unknown[]) => logs.push(a),
      warn: (...a: unknown[]) => logs.push(a),
      error: (...a: unknown[]) => logs.push(a),
    };
    const r = new Reconciler({ cluster, works, cfg: runnerConfig(), now: () => new Date(clock.t), log });
    await r.reconcileOnce();
    const name = `agent-${agent.agentUserId}`;
    /** 노드 압박으로 쫓겨난 것처럼 Pod 를 끝낸다. */
    const evict = () => {
      cluster.get<V1Pod>('Pod', name)!.status = { phase: 'Failed', reason: 'Evicted', message: 'low on ephemeral-storage' };
    };
    const lastObserved = () => works.reportObserved.mock.calls.at(-1)?.[0]?.find((a) => a.agentUserId === agent.agentUserId);
    return { cluster, works, r, logs, clock, name, evict, lastObserved };
  }

  it('backsOffRepeatedFinishesAndReportsFailedAfterThree', async () => {
    const { cluster, r, clock, name, evict, lastObserved } = await loopSetup();

    // 1번째 — 바로 다시 만든다
    evict();
    expect(await r.clusterNeedsReconcile()).toBe(true);
    await r.reconcileOnce();
    expect(cluster.get('Pod', name)).toBeUndefined();
    await r.reconcileOnce();
    expect(cluster.get('Pod', name)).toBeDefined();

    // 2번째 — 30초 간격 전에는 깨우지도 지우지도 않는다
    evict();
    clock.t += 10_000;
    expect(await r.clusterNeedsReconcile()).toBe(false);
    cluster.calls.length = 0;
    expect((await r.reconcileOnce()).retry).toBeUndefined();
    expect(cluster.calls).toEqual([]);
    clock.t += 20_000;
    expect(await r.clusterNeedsReconcile()).toBe(true);
    await r.reconcileOnce();
    await r.reconcileOnce();
    expect(cluster.get<V1Pod>('Pod', name)?.status).toBeUndefined();

    // 3번째 — 1분 간격. 다시 만든 뒤 관찰 보고는 FAILED + 끝난 사유
    evict();
    clock.t += 59_000;
    expect(await r.clusterNeedsReconcile()).toBe(false);
    clock.t += 1_000;
    expect(await r.clusterNeedsReconcile()).toBe(true);
    await r.reconcileOnce();
    await r.reconcileOnce();
    await r.reportObserved();
    expect(lastObserved()).toMatchObject({ phase: 'FAILED', message: expect.stringContaining('연속 3번') });
    expect(lastObserved()?.message).toContain('Evicted — low on ephemeral-storage');

    // 4번째 — 2분 간격
    evict();
    clock.t += 119_000;
    expect(await r.clusterNeedsReconcile()).toBe(false);
    clock.t += 1_000;
    expect(await r.clusterNeedsReconcile()).toBe(true);
  });

  it('resetsAfterPodStaysReadyOrGenerationChanges', async () => {
    const { cluster, works, r, clock, name, evict } = await loopSetup();
    evict();
    await r.reconcileOnce();
    await r.reconcileOnce();

    // 새 Pod 가 Ready 로 10분 떠 있었다 — 기록이 지워져 다음 끝남은 바로 다시 만든다
    clock.t += 11 * 60_000;
    cluster.get<V1Pod>('Pod', name)!.status = {
      phase: 'Running',
      conditions: [{ type: 'Ready', status: 'True', lastTransitionTime: new Date(clock.t - 10 * 60_000) }],
    };
    expect(await r.clusterNeedsReconcile()).toBe(false);
    evict();
    expect(await r.clusterNeedsReconcile()).toBe(true);
    await r.reconcileOnce();
    await r.reconcileOnce();

    // 곧바로 또 끝남 — 간격 중이지만 generation 이 바뀌면 다른 Pod 라 기록을 지우고 바로 다시 만든다
    evict();
    expect(await r.clusterNeedsReconcile()).toBe(false);
    works.desired = desired([desiredAgent({ generation: 8 })]);
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toEqual([`delete Pod/${name}`]);
  });

  it('logsFinishReasonAndReportsItOnNextObserved', async () => {
    const { cluster, works, r, logs, name, evict, lastObserved } = await loopSetup();
    evict();
    // generation 도 바뀐 Pod — 두 까닭을 함께 남긴다
    works.desired = desired([desiredAgent({ generation: 8 })]);
    cluster.calls.length = 0;
    await r.reconcileOnce();
    expect(cluster.calls).toEqual([`delete Pod/${name}`]);
    expect(logs).toContainEqual([
      '끝나 버렸고 generation 도 바뀐 Pod 를 다시 만듭니다',
      expect.objectContaining({ generation: 8, podGeneration: 7, reason: 'Evicted — low on ephemeral-storage', consecutive: 1 }),
    ]);

    // Pod 는 이미 지워졌다 — 다음 보고 한 번에 끝난 사유를 싣고(phase 는 지금 상태), 그다음 보고에는 싣지 않는다
    await r.reportObserved();
    expect(lastObserved()).toMatchObject({ phase: 'STARTING', message: '이전 Pod 가 끝나 다시 띄웠습니다 — Evicted — low on ephemeral-storage' });
    await r.reportObserved();
    expect(lastObserved()).toMatchObject({ phase: 'STARTING', message: null });
  });
});

describe('ClusterCheck', () => {
  const logs: unknown[][] = [];
  const log = {
    info: (...a: unknown[]) => logs.push(a),
    warn: (...a: unknown[]) => logs.push(a),
    error: (...a: unknown[]) => logs.push(a),
  };

  function fakeTimers() {
    const scheduled: { fn: () => void; ms: number }[] = [];
    return {
      scheduled,
      timers: {
        setTimeout: (fn: () => void, ms: number) => {
          scheduled.push({ fn, ms });
          return scheduled.length;
        },
        clearTimeout: () => {},
      },
    };
  }

  it('wakesLoopOnlyWhenClusterDiverges', async () => {
    const answers = [false, true];
    const wake = vi.fn();
    const { scheduled, timers } = fakeTimers();
    const check = new ClusterCheck(async () => answers.shift()!, wake, 30_000, log, timers);
    check.start();
    expect(scheduled.map((t) => t.ms)).toEqual([30_000]);

    await check.tick();
    expect(wake).not.toHaveBeenCalled();
    await check.tick();
    expect(wake).toHaveBeenCalledTimes(1);
    // 한 번 볼 때마다 다음 간격을 하나만 예약한다
    expect(scheduled.map((t) => t.ms)).toEqual([30_000, 30_000, 30_000]);
  });

  it('keepsCheckingAfterErrorAndStops', async () => {
    const wake = vi.fn();
    const { scheduled, timers } = fakeTimers();
    const check = new ClusterCheck(
      async () => {
        throw new Error('api server down');
      },
      wake,
      30_000,
      log,
      timers,
    );
    await check.tick();
    expect(wake).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    check.stop();
    await check.tick();
    expect(scheduled).toHaveLength(1);
  });
});

describe('ReconcileLoop', () => {
  const silent = { info: () => {}, warn: () => {}, error: () => {} };

  function fakeTimers() {
    const scheduled: number[] = [];
    return {
      scheduled,
      timers: {
        setTimeout: (_fn: () => void, ms: number) => {
          scheduled.push(ms);
          return scheduled.length;
        },
        clearTimeout: () => {},
      },
    };
  }

  it('coalescesTriggersWhileRunning', async () => {
    let release!: () => void;
    let runs = 0;
    const run = async () => {
      runs++;
      if (runs === 1) await new Promise<void>((r) => (release = r));
      return { pollIntervalSeconds: 300 };
    };
    const { scheduled, timers } = fakeTimers();
    const loop = new ReconcileLoop(run, silent, timers);

    const first = loop.trigger();
    await loop.trigger();
    await loop.trigger();
    release();
    await first;

    // 도는 중 온 두 트리거는 한 번으로 합쳐진다
    expect(runs).toBe(2);
    expect(scheduled).toEqual([300_000]);
  });

  it('schedulesRetrySoonOrAfterError', async () => {
    const results: (() => Promise<ReconcileResult>)[] = [
      async () => ({ retry: 'soon', pollIntervalSeconds: 300 }),
      // 지우는 중인 것이 사라지기만 기다림 — 15초 뒤
      async () => ({ retry: 'wait', pollIntervalSeconds: 300 }),
      // 클러스터가 거절한 AI 만 남음 — 30초 뒤
      async () => ({ retry: 'later', pollIntervalSeconds: 300 }),
      async () => {
        throw new Error('Works down');
      },
    ];
    const { scheduled, timers } = fakeTimers();
    const loop = new ReconcileLoop(() => results.shift()!(), silent, timers);
    await loop.trigger();
    await loop.trigger();
    await loop.trigger();
    await loop.trigger();
    expect(scheduled).toEqual([5_000, 15_000, 30_000, 30_000]);
  });
});
