import { describe, expect, it } from 'vitest';

import type { AgentResponse } from '../types/agent';
import { compareDottedVersions, externalKeyStatusText, pluginUpdateInfo } from './agentRuntime';

describe('agentRuntime', () => {
  it('외부 AI 마지막 접속', () => {
    expect(externalKeyStatusText(null)).toBe('아직 접속 안 함');
    expect(externalKeyStatusText(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('마지막 접속 5분 전');
  });
});

describe('compareDottedVersions (WP-1707) — gw-plugin-version 과 같은 점 숫자 비교', () => {
  it.each([
    ['0.1.49', '0.1.51', -1],
    ['0.1.51', '0.1.51', 0],
    ['0.1.52', '0.1.51', 1],
    // 문자열 비교면 「0.1.9」 가 더 크다 — 숫자로 견준다.
    ['0.1.9', '0.1.10', -1],
    ['0.1.10', '0.1.9', 1],
    // 자리 수가 달라도 빈 자리는 0 으로 본다.
    ['0.2', '0.2.0', 0],
    ['0.2', '0.2.1', -1],
  ])('%s vs %s → %i', (a, b, expected) => {
    expect(Math.sign(compareDottedVersions(a, b))).toBe(expected);
  });
});

describe('pluginUpdateInfo (WP-1707)', () => {
  const agent = (patch: Partial<AgentResponse>): Pick<AgentResponse, 'runMode' | 'pluginVersion' | 'latestPluginVersion'> => ({
    runMode: 'EXTERNAL',
    pluginVersion: '0.1.49',
    latestPluginVersion: '0.1.51',
    ...patch,
  });

  it('외부 AI 가 최신보다 낮은 버전을 보고했으면 업데이트 필요 — 제목은 「플러그인 보고 → 최신」', () => {
    expect(pluginUpdateInfo(agent({}))).toEqual({ reported: '0.1.49', latest: '0.1.51', updateNeeded: true, title: '플러그인 0.1.49 → 0.1.51' });
    expect(pluginUpdateInfo(agent({ pluginVersion: '0.1.9', latestPluginVersion: '0.1.10' }))?.updateNeeded).toBe(true);
  });

  it('같거나 더 높으면 업데이트 필요 아님', () => {
    expect(pluginUpdateInfo(agent({ pluginVersion: '0.1.51' }))?.updateNeeded).toBe(false);
    expect(pluginUpdateInfo(agent({ pluginVersion: '0.1.52' }))?.updateNeeded).toBe(false);
    expect(pluginUpdateInfo(agent({ pluginVersion: '0.1.10', latestPluginVersion: '0.1.9' }))?.updateNeeded).toBe(false);
  });

  it('최신 버전을 모르면(로컬) 보고 버전만 — 판정하지 않는다', () => {
    expect(pluginUpdateInfo(agent({ latestPluginVersion: null }))).toEqual({ reported: '0.1.49', latest: null, updateNeeded: false, title: null });
    expect(pluginUpdateInfo(agent({ latestPluginVersion: undefined }))?.updateNeeded).toBe(false);
  });

  it('보고가 없거나 외부가 아니면(기본·작업 공간) null', () => {
    expect(pluginUpdateInfo(agent({ pluginVersion: null }))).toBeNull();
    expect(pluginUpdateInfo(agent({ pluginVersion: undefined }))).toBeNull();
    expect(pluginUpdateInfo(agent({ runMode: 'SERVER' }))).toBeNull();
    expect(pluginUpdateInfo(agent({ runMode: 'WORKSPACE' }))).toBeNull();
  });

  it('점 숫자 모양이 아닌 값은 판정하지 않는다', () => {
    expect(pluginUpdateInfo(agent({ latestPluginVersion: 'latest' }))?.updateNeeded).toBe(false);
    expect(pluginUpdateInfo(agent({ pluginVersion: 'x' }))).toBeNull();
  });
});
