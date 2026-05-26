import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from './system-prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('필수 키워드 포함 (도구 이름 4개 + 톤·언어)', () => {
    expect(SYSTEM_PROMPT).toContain('get_issue_detail');
    expect(SYSTEM_PROMPT).toContain('add_comment');
    expect(SYSTEM_PROMPT).toContain('update_status');
    expect(SYSTEM_PROMPT).toContain('unassign_self');
    expect(SYSTEM_PROMPT).toContain('한국어');
    expect(SYSTEM_PROMPT).toContain('이모지 금지');
  });
});
