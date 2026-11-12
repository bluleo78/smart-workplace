import { describe, expect, it } from 'vitest';

import { LINK_RULE_AUTOLINK, LINK_RULE_WIKI } from './link-rule.js';
import { buildSharedTools, type SharedToolClient } from './shared-tools.js';

// WP-1523: 본문을 쓰는 도구는 설명 끝에 링크 규칙을 싣는다 — 이슈 키가 자동 링크가 되는 곳과 노트(되지 않는 곳)를 구분해 정확히 말한다.
describe('본문 쓰기 도구의 링크 규칙 (WP-1523)', () => {
  const tools = buildSharedTools({} as unknown as SharedToolClient);
  const desc = (name: string) => tools.find((t) => t.name === name)?.description ?? '';

  it('이슈·코멘트·이슈 챗·채널 메시지를 쓰는 도구는 키 자동 링크 규칙을 싣는다', () => {
    for (const n of ['create_issue', 'update_issue', 'add_comment', 'update_comment', 'add_issue_chat', 'add_channel_message', 'update_channel_message']) {
      expect(desc(n), n).toContain(LINK_RULE_AUTOLINK.trim());
    }
  });

  it('노트를 쓰는 도구는 키가 자동 링크가 되지 않는다는 규칙을 싣는다', () => {
    for (const n of ['create_wiki_page', 'update_wiki_page']) {
      expect(desc(n), n).toContain(LINK_RULE_WIKI.trim());
      expect(desc(n), n).not.toContain(LINK_RULE_AUTOLINK.trim());
    }
  });
});
