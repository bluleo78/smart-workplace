import { describe, expect, it } from 'vitest';

import { assistantSystemPrompt } from './assistant-system-prompt.js';
import { CHAT_SYSTEM_PROMPT } from './chat-system-prompt.js';
import { MESSAGING_SYSTEM_PROMPT } from './messaging-system-prompt.js';
import { loadSubagents, withLinkRule } from './subagent-loader.js';
import { RECURRING_RUN_SYSTEM_PROMPT, SYSTEM_PROMPT, WORKPLACE_LINK_RULE } from './system-prompt.js';

// WP-1523: AI 가 본문·코멘트·메시지에 없는 화면 주소를 지어냈다 — 웹 AI Chat 의 본문을 쓰는 프롬프트가 모두 같은 링크 규칙(이슈는 키, 주소는 도구 url 만)을 싣는다.
describe('링크 규칙 (WP-1523)', () => {
  it('규칙은 이슈 키와 도구 url 만 쓰라는 한 줄이다', () => {
    expect(WORKPLACE_LINK_RULE).toContain('WP-12');
    expect(WORKPLACE_LINK_RULE).toContain('url');
    expect(WORKPLACE_LINK_RULE).toContain('직접 만들지 않습니다');
    // 노트는 키를 링크로 바꾸지 않는다 — 자동 링크 범위를 정확히 적고, 그 밖에는 도구 url 을 쓰게 한다.
    expect(WORKPLACE_LINK_RULE).toContain('이슈 본문·코멘트·채팅');
    expect(WORKPLACE_LINK_RULE).toContain('노트');
    expect(WORKPLACE_LINK_RULE).not.toContain('\n');
  });

  it('비서(라우터)·이슈 담당·반복 실행·이슈 챗·메시징 프롬프트가 규칙을 싣는다', () => {
    for (const [name, prompt] of [
      ['assistant(claude)', assistantSystemPrompt('claude')],
      ['assistant(opencode)', assistantSystemPrompt('opencode')],
      ['issue', SYSTEM_PROMPT],
      ['recurring', RECURRING_RUN_SYSTEM_PROMPT],
      ['chat', CHAT_SYSTEM_PROMPT],
      ['messaging', MESSAGING_SYSTEM_PROMPT],
    ] as const) {
      expect(prompt, name).toContain(WORKPLACE_LINK_RULE);
    }
  });

  it('하위 에이전트 정의는 모두 끝에 규칙 한 줄을 싣는다(agent.md 마다 베끼지 않고 로더가 붙인다)', () => {
    const defs = loadSubagents();
    // 본문을 쓰는 하위 에이전트가 빠지지 않았는지 — 이름이 바뀌면 여기서 드러난다.
    for (const name of ['issue-agent', 'wiki-agent', 'messaging-agent', 'calendar-agent', 'drive-agent', 'mail-agent']) {
      expect(defs[name], name).toBeDefined();
    }
    for (const [name, def] of Object.entries(defs)) {
      expect(def.prompt.endsWith(`\n\n- ${WORKPLACE_LINK_RULE}\n`), name).toBe(true);
      expect(def.prompt.split(WORKPLACE_LINK_RULE).length - 1, name).toBe(1);
    }
  });

  it('withLinkRule 은 끝 공백을 정리하고 빈 줄 하나 뒤에 붙인다', () => {
    expect(withLinkRule('본문\n\n\n')).toBe(`본문\n\n- ${WORKPLACE_LINK_RULE}\n`);
  });
});
