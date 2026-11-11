// planReconcile·collectActual — desired 와 클러스터에 남은 runner 리소스를 맞춰 AI 마다 할 일을 고르는 규칙.
import { describe, expect, it } from 'vitest';
import type { V1ConfigMap, V1PersistentVolumeClaim, V1Pod, V1Secret } from '@kubernetes/client-node';
import { checkImages, collectActual, planReconcile, type ActualAgent } from './plan.js';
import { desiredAgent } from './testing/fixtures.js';

const MANAGED = { 'app.kubernetes.io/managed-by': 'genia-agent-runner' };

function actual(overrides: Partial<ActualAgent> & { agentUserId: number }): ActualAgent {
  return { pvc: true, secret: true, configMap: true, ...overrides };
}

describe('planReconcile', () => {
  it('createsMissingAgentRegardlessOfApplyNow', () => {
    const actions = planReconcile(
      [desiredAgent({ agentUserId: 1, applyNow: false }), desiredAgent({ agentUserId: 2, applyNow: true })],
      // 1 은 PVC·Secret 만 남아 있고(Pod 없음) 2 는 아무것도 없다
      [actual({ agentUserId: 1, configMap: false })],
    );
    expect(actions.map((a) => [a.agentUserId, a.kind])).toEqual([
      [1, 'create'],
      [2, 'create'],
    ]);
  });

  it('keepsPodWhenGenerationDiffersAndApplyNowFalse', () => {
    const actions = planReconcile(
      [desiredAgent({ agentUserId: 1, generation: 8, applyNow: false })],
      [actual({ agentUserId: 1, pod: { generation: 7, deleting: false } })],
    );
    expect(actions).toEqual([{ kind: 'keep', agentUserId: 1, reason: expect.stringContaining('applyNow') }]);
  });

  it('recreatesWhenGenerationDiffersAndApplyNowTrue', () => {
    const actions = planReconcile(
      [
        desiredAgent({ agentUserId: 1, generation: 8, applyNow: true }),
        desiredAgent({ agentUserId: 2, generation: 7, applyNow: true }),
        // 지우는 중인 Pod 는 사라질 때까지 기다린다(다음 회차에 create)
        desiredAgent({ agentUserId: 3, generation: 8, applyNow: true }),
      ],
      [
        actual({ agentUserId: 1, pod: { generation: 7, deleting: false } }),
        actual({ agentUserId: 2, pod: { generation: 7, deleting: false } }),
        actual({ agentUserId: 3, pod: { generation: 7, deleting: true } }),
      ],
    );
    expect(actions.map((a) => [a.agentUserId, a.kind])).toEqual([
      [1, 'recreate'],
      [2, 'keep'],
      [3, 'keep'],
    ]);
    expect(actions[2]?.reason).toContain('terminating');
  });

  it('deletesAgentsNotInDesiredKeepingConfigMapUntilStopped', () => {
    const actions = planReconcile(
      [],
      [
        // Pod 가 아직 있음 → delete(Pod·PVC·Secret), ConfigMap 은 남긴다
        actual({ agentUserId: 1, pod: { generation: 7, deleting: false } }),
        // Pod 는 사라지고 ConfigMap 만 남음 → STOPPED 를 보내고 ConfigMap 을 지운다
        actual({ agentUserId: 2, pvc: false, secret: false, configMap: true }),
        // Pod 는 사라졌는데 PVC 가 아직 지워지는 중 → 그래도 STOPPED 보고 단계
        actual({ agentUserId: 3, pvc: true, secret: false, configMap: true }),
      ],
    );
    expect(actions.map((a) => [a.agentUserId, a.kind])).toEqual([
      [1, 'delete'],
      [2, 'reportStopped'],
      [3, 'reportStopped'],
    ]);
  });

  it('recreatesFinishedPodRegardlessOfGenerationAndApplyNow', () => {
    // 노드 재시작 뒤 Completed·Error 로 남은 맨 Pod(WP-1501) — 아무도 다시 띄우지 않으므로 runner 가 갈아 끼운다
    const actions = planReconcile(
      [
        desiredAgent({ agentUserId: 1, generation: 7, applyNow: false }),
        desiredAgent({ agentUserId: 2, generation: 8, applyNow: false }),
        // 끝났지만 이미 지우는 중이면 사라질 때까지 기다린다(다음 회차에 create)
        desiredAgent({ agentUserId: 3, generation: 7, applyNow: true }),
      ],
      [
        actual({ agentUserId: 1, pod: { generation: 7, deleting: false, finished: true } }),
        actual({ agentUserId: 2, pod: { generation: 7, deleting: false, finished: true } }),
        actual({ agentUserId: 3, pod: { generation: 7, deleting: true, finished: true } }),
      ],
    );
    expect(actions.map((a) => [a.agentUserId, a.kind, a.reason])).toEqual([
      [1, 'recreate', 'pod finished'],
      [2, 'recreate', 'pod finished'],
      [3, 'keep', 'pod terminating'],
    ]);
  });

  it('deletesFinishedPodNotInDesired', () => {
    // 끈 AI 의 끝난 Pod 는 다시 만들지 않고 여느 때처럼 지운다(Pod·PVC·Secret)
    const actions = planReconcile([], [actual({ agentUserId: 1, pod: { generation: 7, deleting: false, finished: true } })]);
    expect(actions.map((a) => [a.agentUserId, a.kind])).toEqual([[1, 'delete']]);
  });

  it('marksOnlySucceededOrFailedPodAsFinished', () => {
    const pod = (id: number, phase: string | undefined): V1Pod => ({
      metadata: { name: `agent-${id}`, labels: { ...MANAGED, 'genia.works/agent': String(id), 'genia.works/generation': '7' } },
      status: phase ? { phase } : undefined,
    });
    const found = collectActual({
      // Running·Pending·Unknown(노드와 연락 끊김)·상태 없음은 끝난 것이 아니다
      pods: [pod(1, 'Succeeded'), pod(2, 'Failed'), pod(3, 'Running'), pod(4, 'Pending'), pod(5, 'Unknown'), pod(6, undefined)],
      pvcs: [],
      secrets: [],
      configMaps: [],
    });
    expect(found.map((a) => [a.agentUserId, a.pod?.finished])).toEqual([
      [1, true],
      [2, true],
      [3, false],
      [4, false],
      [5, false],
      [6, false],
    ]);
  });

  it('ignoresResourcesWithoutRunnerLabel', () => {
    const pods: V1Pod[] = [
      { metadata: { name: 'agent-1', labels: { ...MANAGED, 'genia.works/agent': '1', 'genia.works/generation': '7' } } },
      // 손으로 만든 시험 Pod — runner 라벨이 없다
      { metadata: { name: 'agent-pod-test', labels: { 'genia.works/agent': '9' } } },
      // 다른 관리자가 만든 Pod
      { metadata: { name: 'agent-8', labels: { 'app.kubernetes.io/managed-by': 'helm', 'genia.works/agent': '8' } } },
    ];
    const pvcs: V1PersistentVolumeClaim[] = [{ metadata: { name: 'agent-9-work', labels: { 'genia.works/agent': '9' } } }];
    const secrets: V1Secret[] = [{ metadata: { name: 'agent-8', labels: { 'genia.works/agent': '8' } } }];
    const configMaps: V1ConfigMap[] = [{ metadata: { name: 'agent-8', labels: { 'genia.works/agent': '8' } } }];

    const found = collectActual({ pods, pvcs, secrets, configMaps });
    expect(found).toEqual([
      { agentUserId: 1, pod: { generation: 7, deleting: false, finished: false }, pvc: false, secret: false, configMap: false },
    ]);
    // desired 가 비어도 라벨 없는 8·9 는 지울 대상이 아니다
    expect(planReconcile([], found).map((a) => a.agentUserId)).toEqual([1]);
  });
});

describe('checkImages', () => {
  const allowed = ['docker.io/iacloudops/genia-works-agent-', 'docker:'];

  it('allowsImagesUnderPrefixes', () => {
    expect(checkImages(desiredAgent(), allowed)).toBeNull();
  });

  it('rejectsAgentOrSidecarImageOutsidePrefixes', () => {
    expect(checkImages(desiredAgent({ image: 'ghcr.io/x/y:1' }), allowed)).toContain('ghcr.io/x/y:1');
    expect(
      checkImages(desiredAgent({ sidecars: [{ name: 'dind', image: 'quay.io/docker:27-dind', privileged: true }] }), allowed),
    ).toContain('quay.io/docker:27-dind');
  });
});
