import { describe, expect, it } from 'vitest'

import { presetLabelFor, toOpencodeProviderConfig } from './opencode-presets'

describe('presetLabelFor', () => {
  it('정확히 같은 baseUrl 은 매칭', () => {
    expect(presetLabelFor('https://api.openai.com/v1')).toBe('OpenAI')
  })

  it('Bedrock 은 리전이 달라도 host 패턴으로 매칭', () => {
    expect(presetLabelFor('https://bedrock-mantle.us-east-1.api.aws/openai/v1')).toBe(
      'AWS Bedrock',
    )
    expect(presetLabelFor('https://bedrock-mantle.ap-northeast-2.api.aws/openai/v1')).toBe(
      'AWS Bedrock',
    )
  })

  it('알 수 없는 host 는 null(호출측이 OpenAI 호환으로 폴백)', () => {
    expect(presetLabelFor('https://my-private-llm.internal/v1')).toBeNull()
  })

  it('null/undefined/빈 문자열은 null', () => {
    expect(presetLabelFor(null)).toBeNull()
    expect(presetLabelFor(undefined)).toBeNull()
    expect(presetLabelFor('')).toBeNull()
  })

  it('잘못된 URL 형식은 예외 없이 null', () => {
    expect(presetLabelFor('not-a-url')).toBeNull()
  })
})

describe('toOpencodeProviderConfig', () => {
  it('Base URL 은 앞뒤 공백을 떼고 API Key 는 그대로 담는다', () => {
    expect(toOpencodeProviderConfig('openai', '  https://api.openai.com/v1 ', ' sk-x ')).toEqual({
      providerId: 'openai',
      options: { baseURL: 'https://api.openai.com/v1', apiKey: ' sk-x ' },
    })
  })
})
