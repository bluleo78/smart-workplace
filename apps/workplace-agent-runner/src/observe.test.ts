// toObserved — Pod 상태를 Works 관찰 보고 phase 로 옮기는 표. parseCpu·parseMemory — metrics.k8s.io 수량 해석.
import { describe, expect, it } from 'vitest';
import type { V1Pod } from '@kubernetes/client-node';
import { parseCpuMillicores, parseMemoryBytes, toObserved } from './observe.js';

function pod(status: V1Pod['status'], extra: Partial<V1Pod['metadata']> = {}): V1Pod {
  return {
    metadata: { name: 'agent-42', labels: { 'genia.works/generation': '7' }, ...extra },
    status,
  };
}

const START = new Date('2026-11-01T00:58:00Z');

describe('toObserved', () => {
  it.each([
    {
      name: 'pendingIsStarting',
      pod: pod({ phase: 'Pending', startTime: START }),
      expected: { phase: 'STARTING', message: null },
    },
    {
      name: 'runningButNotReadyIsStarting',
      pod: pod({
        phase: 'Running',
        startTime: START,
        containerStatuses: [
          { name: 'agent', ready: true, restartCount: 0, image: 'x', imageID: 'x' },
          { name: 'dind', ready: false, restartCount: 0, image: 'x', imageID: 'x' },
        ],
      }),
      expected: { phase: 'STARTING', message: null },
    },
    {
      name: 'allReadyIsRunning',
      pod: pod({
        phase: 'Running',
        startTime: START,
        containerStatuses: [
          { name: 'agent', ready: true, restartCount: 0, image: 'x', imageID: 'x' },
          { name: 'dind', ready: true, restartCount: 0, image: 'x', imageID: 'x' },
        ],
      }),
      expected: { phase: 'RUNNING', message: null },
    },
    {
      name: 'crashLoopIsFailed',
      pod: pod({
        phase: 'Running',
        startTime: START,
        containerStatuses: [
          {
            name: 'agent',
            ready: false,
            restartCount: 5,
            image: 'x',
            imageID: 'x',
            state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s' } },
          },
        ],
      }),
      expected: { phase: 'FAILED', message: 'agent: CrashLoopBackOff — back-off 5m0s' },
    },
    {
      name: 'imagePullBackOffIsFailed',
      pod: pod({
        phase: 'Pending',
        startTime: START,
        containerStatuses: [
          {
            name: 'agent',
            ready: false,
            restartCount: 0,
            image: 'x',
            imageID: '',
            state: { waiting: { reason: 'ImagePullBackOff' } },
          },
        ],
      }),
      expected: { phase: 'FAILED', message: 'agent: ImagePullBackOff' },
    },
    {
      name: 'podFailedIsFailed',
      pod: pod({ phase: 'Failed', startTime: START, reason: 'Evicted', message: 'low on ephemeral-storage' }),
      expected: { phase: 'FAILED', message: 'Evicted — low on ephemeral-storage' },
    },
    {
      name: 'deletionTimestampIsStopping',
      pod: pod({ phase: 'Running', startTime: START }, { deletionTimestamp: new Date('2026-11-01T01:00:00Z') }),
      expected: { phase: 'STOPPING', message: null },
    },
  ])('$name', ({ pod: p, expected }) => {
    const observed = toObserved(p, false);
    expect(observed).toEqual({
      observedGeneration: 7,
      startedAt: '2026-11-01T00:58:00.000Z',
      ...expected,
    });
  });

  it('noPodWhileStoppingIsStopped', () => {
    expect(toObserved(undefined, true)).toEqual({
      observedGeneration: null,
      phase: 'STOPPED',
      message: null,
      startedAt: null,
    });
  });

  it('noPodForDesiredAgentIsStarting', () => {
    expect(toObserved(undefined, false).phase).toBe('STARTING');
  });

  it('acceptsStringTimestampsFromFakes', () => {
    const p = pod({ phase: 'Pending', startTime: '2026-11-01T00:58:00Z' as unknown as Date });
    expect(toObserved(p, false).startedAt).toBe('2026-11-01T00:58:00.000Z');
  });

  it('truncatesLongMessagesTo500', () => {
    const p = pod({ phase: 'Failed', reason: 'X', message: 'y'.repeat(800) });
    expect(toObserved(p, false).message).toHaveLength(500);
  });
});

describe('quantities', () => {
  it('parsesCpu', () => {
    expect(parseCpuMillicores('1200m')).toBe(1200);
    expect(parseCpuMillicores('250000000n')).toBe(250);
    expect(parseCpuMillicores('1500u')).toBe(2);
    expect(parseCpuMillicores('2')).toBe(2000);
    expect(parseCpuMillicores('bogus')).toBeUndefined();
  });

  it('parsesMemory', () => {
    expect(parseMemoryBytes('3Gi')).toBe(3 * 1024 ** 3);
    expect(parseMemoryBytes('1024Ki')).toBe(1024 * 1024);
    expect(parseMemoryBytes('500M')).toBe(500_000_000);
    expect(parseMemoryBytes('123456')).toBe(123456);
    expect(parseMemoryBytes('bogus')).toBeUndefined();
  });
});
