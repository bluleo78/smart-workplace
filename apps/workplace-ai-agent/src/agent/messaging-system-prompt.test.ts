import { describe, it, expect } from 'vitest';
import { MESSAGING_SYSTEM_PROMPT } from './messaging-system-prompt.js';

describe('MESSAGING_SYSTEM_PROMPT', () => {
  // WP-1489: 가진 도구로 할 수 없는 요청(예: 이슈 필드 변경)도 add_channel_message 로 할 수 없다고 짧게 답하고 방법을 안내한다 —
  // 답 없이 끝내지 않게.
  it('할 수 없는 요청은 add_channel_message 로 할 수 없다고 밝히고 방법을 안내하는 원칙을 담는다', () => {
    expect(MESSAGING_SYSTEM_PROMPT).toContain('할 수 없는 요청');
    expect(MESSAGING_SYSTEM_PROMPT).toContain('이슈 필드');
    expect(MESSAGING_SYSTEM_PROMPT).toContain('이슈 화면에서 직접');
    expect(MESSAGING_SYSTEM_PROMPT).toMatch(/할 수 없는 요청[^\n]*add_channel_message/);
  });
});
