// WP-1322 생각의 깊이 선택지·보정 — 개인 비서·공통 비서 화면 공용 규칙.
import { describe, expect, it } from 'vitest';

import {
  clampThinkingDepth,
  supportedLevels,
  thinkingDepthOptions,
  thinkingDepthPatchForModel,
  thinkingDepthView,
} from './thinkingDepth';

const claudeAll = { id: 'claude-opus-5-5', label: 'Opus', efforts: ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'] as const };
const claudeUnknown = { id: 'claude-haiku-4-5', label: 'Haiku', efforts: null };
const gpt5 = { id: 'p/gpt-5', label: 'p/gpt-5', efforts: ['LOW', 'MEDIUM', 'HIGH'] as const };
const qwen = { id: 'p/qwen3', label: 'p/qwen3', efforts: [] };
const models = [
  { ...claudeAll, efforts: [...claudeAll.efforts] },
  claudeUnknown,
  { ...gpt5, efforts: [...gpt5.efforts] },
  qwen,
];

describe('supportedLevels', () => {
  it('efforts 가 있으면 그것(낮은 순)', () => {
    expect(supportedLevels('anthropic', { id: 'x', label: 'x', efforts: ['MAX', 'LOW'] })).toEqual(['LOW', 'MAX']);
  });
  it('모르면 Claude 는 LOW·MEDIUM·HIGH, OpenAI 호환은 없음', () => {
    expect(supportedLevels('anthropic', claudeUnknown)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(supportedLevels('anthropic', undefined)).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(supportedLevels('opencode', { id: 'p/x', label: 'x' })).toEqual([]);
    expect(supportedLevels('opencode', undefined)).toEqual([]);
  });
  it('빈 목록은 단계를 받지 않는 모델', () => {
    expect(supportedLevels('anthropic', { id: 'x', label: 'x', efforts: [] })).toEqual([]);
  });
});

describe('thinkingDepthOptions', () => {
  it('「설정 안 함」이 맨 앞, 그 뒤 지원 단계 순서대로 한국어 문구', () => {
    expect(thinkingDepthOptions(['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX']).map((o) => o.label)).toEqual([
      '설정 안 함',
      '낮게',
      '보통',
      '높게',
      '매우 높게',
      '최대',
    ]);
    expect(thinkingDepthOptions([]).map((o) => o.value)).toEqual(['DEFAULT']);
  });
});

describe('clampThinkingDepth', () => {
  it('지원하면 그대로, 아니면 바로 아래 지원 단계, 없으면 DEFAULT', () => {
    expect(clampThinkingDepth('HIGH', ['LOW', 'MEDIUM', 'HIGH'])).toBe('HIGH');
    expect(clampThinkingDepth('MAX', ['LOW', 'MEDIUM', 'HIGH'])).toBe('HIGH');
    expect(clampThinkingDepth('XHIGH', ['LOW', 'MAX'])).toBe('LOW');
    expect(clampThinkingDepth('LOW', ['HIGH'])).toBe('DEFAULT');
    expect(clampThinkingDepth('HIGH', [])).toBe('DEFAULT');
  });
  it('미설정·옛 값·모르는 값은 DEFAULT', () => {
    expect(clampThinkingDepth(null, ['LOW'])).toBe('DEFAULT');
    expect(clampThinkingDepth('NORMAL', ['LOW', 'MEDIUM', 'HIGH'])).toBe('DEFAULT');
    expect(clampThinkingDepth('DEFAULT', ['LOW'])).toBe('DEFAULT');
  });
});

describe('thinkingDepthView', () => {
  it('고른 모델의 단계로 선택지를 만들고 저장값을 보정해 보인다', () => {
    const v = thinkingDepthView({ provider: 'opencode', models, modelId: 'p/gpt-5', saved: 'MAX' });
    expect(v.options.map((o) => o.value)).toEqual(['DEFAULT', 'LOW', 'MEDIUM', 'HIGH']);
    expect(v.value).toBe('HIGH');
    expect(thinkingDepthView({ provider: 'opencode', models, modelId: 'p/qwen3', saved: 'LOW' }).value).toBe('DEFAULT');
  });
  it('목록을 불러오는 동안은 저장값을 보정하지 않는다', () => {
    const v = thinkingDepthView({ provider: 'opencode', models: [], modelId: 'p/gpt-5', saved: 'HIGH', loading: true });
    expect(v.value).toBe('HIGH');
    expect(v.options.map((o) => o.value)).toEqual(['DEFAULT', 'HIGH']);
  });
});

describe('thinkingDepthPatchForModel', () => {
  it('새 모델이 저장값을 받지 않으면 보정값을 같이 저장한다', () => {
    expect(thinkingDepthPatchForModel({ provider: 'anthropic', models, nextModelId: 'claude-haiku-4-5', saved: 'MAX' })).toEqual({
      thinkingDepth: 'HIGH',
    });
    expect(thinkingDepthPatchForModel({ provider: 'opencode', models, nextModelId: 'p/qwen3', saved: 'LOW' })).toEqual({
      thinkingDepth: 'DEFAULT',
    });
  });
  it('받는 값·미설정이면 보내지 않는다', () => {
    expect(thinkingDepthPatchForModel({ provider: 'anthropic', models, nextModelId: 'claude-opus-5-5', saved: 'MAX' })).toEqual({});
    expect(thinkingDepthPatchForModel({ provider: 'opencode', models, nextModelId: 'p/qwen3', saved: null })).toEqual({});
  });
});
