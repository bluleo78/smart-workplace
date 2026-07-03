import { describe, it, expect } from 'vitest';

import { registerBridge, takeBridge, releaseBridge } from './bridge-registry.js';
import type { HostBridge } from '../mcp/tools.js';

function fakeBridge(): HostBridge {
  return {
    onProposal: () => {},
    onSubmitResponse: () => {},
    onUnassignResult: () => {},
  };
}

describe('bridge-registry', () => {
  it('등록한 브리지를 runId 로 조회할 수 있다', () => {
    const bridge = fakeBridge();
    registerBridge('run-1', bridge);
    expect(takeBridge('run-1')).toBe(bridge);
    releaseBridge('run-1');
  });

  it('takeBridge 는 조회 후에도 항목을 제거하지 않는다', () => {
    const bridge = fakeBridge();
    registerBridge('run-2', bridge);
    expect(takeBridge('run-2')).toBe(bridge);
    expect(takeBridge('run-2')).toBe(bridge);
    releaseBridge('run-2');
  });

  it('미등록 runId 조회 시 undefined', () => {
    expect(takeBridge('never-registered')).toBeUndefined();
  });

  it('releaseBridge 이후 조회하면 undefined', () => {
    const bridge = fakeBridge();
    registerBridge('run-3', bridge);
    releaseBridge('run-3');
    expect(takeBridge('run-3')).toBeUndefined();
  });

  it('releaseBridge 는 미등록 runId 에 대해서도 안전하다(no-op)', () => {
    expect(() => releaseBridge('not-there')).not.toThrow();
  });
});
