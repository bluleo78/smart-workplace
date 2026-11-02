// Reconciler — 가짜 클러스터·Works 로 조정 한 회차씩 돌려 Review Focus(키 재발급 폭주·applyNow·STOPPED)를 단언한다.
import { describe, expect, it } from 'vitest';
import type { V1PersistentVolumeClaim, V1Pod, V1Secret } from '@kubernetes/client-node';
import { ReconcileLoop, Reconciler, type ReconcileResult } from './reconciler.js';
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
function seedRunningAgent(cluster: FakeCluster, agent: RunnerDesiredAgent, locationId = ctx.locationId) {
  const { pod, pvc, configMap } = buildAgentResources(agent, { ...ctx, locationId }, runnerConfig(), { claudeVersion: '57', repos: REPO_MOUNT });
  cluster.seed(pod);
  cluster.seed(pvc!);
  cluster.seed(configMap);
  cluster.seed(
    buildAgentSecret(
      agent.agentUserId,
      locationId,
      'agents',
      { 'agent-key': 'ak_old', 'claude-token': 'sk-ant-old', 'repo-github-github.com': 'ghp_old' },
      {
        'genia.works/agent-key-id': '812',
        'genia.works/agent-key-rotate-after': '2026-11-24T01:00:00.000Z',
        'genia.works/claude-version': '57',
        'genia.works/repos-version': REPOS_V,
        'genia.works/repo-hosts': 'GITHUB:github.com',
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
