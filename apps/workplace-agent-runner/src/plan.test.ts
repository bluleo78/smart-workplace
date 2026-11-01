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
      { agentUserId: 1, pod: { generation: 7, deleting: false }, pvc: false, secret: false, configMap: false },
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
