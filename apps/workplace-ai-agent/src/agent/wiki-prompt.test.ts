import { describe, expect, it } from 'vitest';

import { buildWikiUserMessage, type WikiComposeInput } from './wiki-prompt.js';

// 공통 입력 — 변형 액션은 selection 을 컨텍스트로 쓴다.
function input(partial: Partial<WikiComposeInput>): WikiComposeInput {
  return {
    assistantAgentId: 1,
    model: 'claude-sonnet-4-6',
    thinkingDepth: 'NONE',
    maxTurns: 5,
    timeoutMs: 90_000,
    action: 'polish',
    pageTitle: '제목',
    pageBody: '전체 본문',
    selection: '선택한 문장',
    ...partial,
  };
}

describe('buildWikiUserMessage — 변형 액션', () => {
  it('rewrite_tone 은 톤(prompt)과 selection 을 포함한다', () => {
    const msg = buildWikiUserMessage(input({ action: 'rewrite_tone', prompt: '격식체' }));
    expect(msg).toContain('격식체');
    expect(msg).toContain('선택한 문장');
  });

  it('translate 는 언어(prompt)와 selection 을 포함한다', () => {
    const msg = buildWikiUserMessage(input({ action: 'translate', prompt: '영어' }));
    expect(msg).toContain('영어');
    expect(msg).toContain('선택한 문장');
  });

  it('expand/condense/polish 는 selection 을 컨텍스트로 쓴다', () => {
    for (const action of ['expand', 'condense', 'polish'] as const) {
      const msg = buildWikiUserMessage(input({ action }));
      expect(msg).toContain('선택한 문장');
    }
  });

  it('selection 이 없으면 pageBody 로 폴백한다', () => {
    const msg = buildWikiUserMessage(input({ action: 'polish', selection: undefined }));
    expect(msg).toContain('전체 본문');
  });
});
