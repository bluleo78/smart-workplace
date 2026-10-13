import { describe, expect, it } from 'vitest';

import { AUTO_SELECT_VALUE, providerIdOf, suggestionModelChoices, withProviderPrefix } from './suggestionModel';

const options = [{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }];

describe('suggestionModelChoices — 자동 라벨은 API 의 suggestionModelAuto 로만', () => {
  it('맨 앞에 "자동 (그 모델의 목록 라벨)", 목록에 없으면 id 그대로', () => {
    expect(suggestionModelChoices({ autoModel: 'claude-haiku-5-5', value: null, options })[0])
      .toEqual({ id: AUTO_SELECT_VALUE, label: '자동 (Claude Haiku 5.5)' });
    // API 설정으로 바꾼 기본값도 그대로 따른다(웹에 상수 없음).
    expect(suggestionModelChoices({ autoModel: 'claude-haiku-test', value: null, options })[0].label).toBe('자동 (claude-haiku-test)');
    expect(suggestionModelChoices({ autoModel: 'p/gpt-4.1', value: null, options: [] })[0].label).toBe('자동 (p/gpt-4.1)');
  });
  it('자동 모델을 모르면(연결 없음·구 API) "자동"', () => {
    expect(suggestionModelChoices({ autoModel: null, value: null, options: [] })[0].label).toBe('자동');
    expect(suggestionModelChoices({ autoModel: undefined, value: null, options: [] })[0].label).toBe('자동');
  });
  it('저장된 값이 목록에 없으면 목록에 덧붙여 빈칸으로 보이지 않게 한다', () => {
    const c = suggestionModelChoices({ autoModel: 'claude-haiku-5-5', value: 'claude-old', options });
    expect(c.map((o) => o.id)).toEqual([AUTO_SELECT_VALUE, 'claude-old', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  });
});

describe('providerIdOf / withProviderPrefix — opencode 모델 id 는 providerId/ 접두가 필수', () => {
  it('providerIdOf — 접두가 있는 모델에서만 providerId 를 뽑는다', () => {
    expect(providerIdOf('amazon-bedrock-openai/gpt-oss')).toBe('amazon-bedrock-openai');
    expect(providerIdOf('claude-sonnet-5-5')).toBeUndefined();
    expect(providerIdOf(null)).toBeUndefined();
    expect(providerIdOf(undefined)).toBeUndefined();
  });
  it('접두가 없으면 붙이고, 이미 있으면 그대로 둔다', () => {
    expect(withProviderPrefix('small', 'amazon-bedrock-openai')).toBe('amazon-bedrock-openai/small');
    expect(withProviderPrefix('amazon-bedrock-openai/small', 'amazon-bedrock-openai')).toBe('amazon-bedrock-openai/small');
    expect(withProviderPrefix('  small  ', 'p')).toBe('p/small');
  });
  it('providerId 를 모르면(anthropic 등) 입력 그대로', () => {
    expect(withProviderPrefix('claude-x', undefined)).toBe('claude-x');
  });
});
