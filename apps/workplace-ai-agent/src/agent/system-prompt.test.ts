import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from './system-prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('필수 키워드 포함 (도구 이름 6개 + 톤·언어)', () => {
    expect(SYSTEM_PROMPT).toContain('get_issue_detail');
    expect(SYSTEM_PROMPT).toContain('add_comment');
    expect(SYSTEM_PROMPT).toContain('edit_comment');
    expect(SYSTEM_PROMPT).toContain('create_issue');
    expect(SYSTEM_PROMPT).toContain('update_issue');
    expect(SYSTEM_PROMPT).toContain('unassign_self');
    expect(SYSTEM_PROMPT).toContain('한국어');
    expect(SYSTEM_PROMPT).toContain('이모지 금지');
  });

  // WP-343: 상태 변경은 update_status 가 아니라 update_issue 의 status 로 지시한다(v1 담당자 루프).
  it('상태 변경 지시는 update_issue 의 status 로 하고 폐지된 update_status 는 언급하지 않는다', () => {
    expect(SYSTEM_PROMPT).not.toContain('update_status');
    expect(SYSTEM_PROMPT).toContain("update_issue({issueKey, status: 'IN_PROGRESS'})");
    expect(SYSTEM_PROMPT).toContain("update_issue({issueKey, status: 'DONE'}) + unassign_self");
    expect(SYSTEM_PROMPT).toContain('TODO / IN_PROGRESS / DONE / CANCELED');
  });
});
