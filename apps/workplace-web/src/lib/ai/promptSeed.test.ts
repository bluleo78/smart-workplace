// WP-414 대기 프롬프트 — 초안 보존 규칙.
import { describe, expect, it } from 'vitest';

import { applyPromptSeed } from './promptSeed';

describe('applyPromptSeed', () => {
  it('입력창이 비었으면(공백만 포함) 문구를 넣는다', () => {
    expect(applyPromptSeed('', '알려줘 ')).toBe('알려줘 ');
    expect(applyPromptSeed('  \n', '알려줘 ')).toBe('알려줘 ');
  });

  it('쓰던 초안이 있으면 덮지 않는다', () => {
    expect(applyPromptSeed('쓰던 질문', '알려줘 ')).toBe('쓰던 질문');
  });
});
