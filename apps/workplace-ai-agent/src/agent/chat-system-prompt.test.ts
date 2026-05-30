import { describe, it, expect } from 'vitest';

import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';

describe('CHAT_SYSTEM_PROMPT', () => {
  it('add_chat_message 1회 + Read 첨부 + 한국어 지침 포함', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('add_chat_message');
    expect(CHAT_SYSTEM_PROMPT).toContain('한 번');
    expect(CHAT_SYSTEM_PROMPT).toContain('Read');
  });
});
