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

/** runner 가 기록을 남긴 채 떠 있는 AI 한 명(재시작 직전 상태)을 클러스터에 넣는다. Pod 는 모델 연결 57 로 만든 것. */
function seedRunningAgent(cluster: FakeCluster, agent: RunnerDesiredAgent, locationId = ctx.locationId) {
  const { pod, pvc, configMap } = buildAgentResources(agent, { ...ctx, locationId }, runnerConfig(), '57');
  cluster.seed(pod);
  cluster.seed(pvc);
  cluster.seed(configMap);
  cluster.seed(
    buildAgentSecret(
      agent.agentUserId,
      locationId,
      'agents',
      { 'agent-key': 'ak_old', 'claude-token': 'sk-ant-old' },
      {
        'genia.works/agent-key-id': '812',
        'genia.works/agent-key-rotate-after': '2026-11-24T01:00:00.000Z',
        'genia.works/claude-version': '57',
      },
    ),
  );
}

function makeReconciler(cluster: FakeCluster, works: FakeWorks, logs: unknown[] = []) {
  const log = {
    info: (...a: unknown[]) => logs.push(a),
    warn: (...a: unknown[]) => logs.push(a),
    error: (...a: unknown[]) => logs.push(a),
  };
  return new Reconciler({ cluster, works, cfg: runnerConfig(), now: () => NOW, log });
}

function decodeSecret(cluster: FakeCluster, name: string) {
  const s = cluster.get<V1Secret>('Secret', name);
  return Object.fromEntries(Object.entries(s?.data ?? {}).map(([k, v]) => [k, Buffer.from(v, 'base64').toString()]));
}

describe('Reconciler', () => {
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
    ]);
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
    ]);
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
    ]);
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
    ]);
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

    // metrics 가 없어도 보고는 나간다
    cluster.failMetrics = true;
    await r.reportObserved();
    expect(works.reportObserved.mock.calls.at(-1)?.[0]?.[0]).toMatchObject({ agentUserId: 1, cpuMillicores: null });
  });

  it('sendsEmptyObservedListToStayConnected', async () => {
    const cluster = new FakeCluster();
    const works = new FakeWorks(desired([]));
    const r = makeReconciler(cluster, works);
    await r.reconcileOnce();
    await r.reportObserved();
    expect(works.reportObserved).toHaveBeenCalledWith([]);
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
