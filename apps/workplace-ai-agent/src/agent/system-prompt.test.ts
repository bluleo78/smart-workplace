import { describe, expect, it } from 'vitest';
import { SYSTEM_PROMPT } from './system-prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('필수 키워드 포함 (도구 이름 6개 + 톤·언어)', () => {
    expect(SYSTEM_PROMPT).toContain('get_issue_detail');
    expect(SYSTEM_PROMPT).toContain('add_comment');
    expect(SYSTEM_PROMPT).toContain('update_comment');
    expect(SYSTEM_PROMPT).toContain('create_issue');
    expect(SYSTEM_PROMPT).toContain('update_issue');
    expect(SYSTEM_PROMPT).toContain('unassign_self');
    expect(SYSTEM_PROMPT).toContain('한국어');
    expect(SYSTEM_PROMPT).toContain('이모지 금지');
  });

  // WP-356: create_issue 가 라벨·마일스톤·사이클을 한 번에 저장한다 — 만든 뒤 update_issue 를 다시 부르라는 안내가 없어야 한다.
  it('create_issue 한 번에 라벨·마일스톤·사이클까지 저장한다고 안내한다', () => {
    expect(SYSTEM_PROMPT).toContain('라벨·마일스톤·사이클도 이 호출 한 번에 함께 저장');
    expect(SYSTEM_PROMPT).toContain('만든 뒤 update_issue 를 다시 부르지 않습니다');
  });

  // WP-343: 상태 변경은 update_status 가 아니라 update_issue 의 status 로 지시한다(v1 담당자 루프).
  it('상태 변경 지시는 update_issue 의 status 로 하고 폐지된 update_status 는 언급하지 않는다', () => {
    expect(SYSTEM_PROMPT).not.toContain('update_status');
    expect(SYSTEM_PROMPT).toContain("update_issue({issueKey, status: 'IN_PROGRESS'})");
    expect(SYSTEM_PROMPT).toContain("update_issue({issueKey, status: 'DONE'}) + unassign_self");
    expect(SYSTEM_PROMPT).toContain('TODO / IN_PROGRESS / DONE / CANCELED');
  });

  // update_issue 는 실패해도 throw 하지 않고 {ok, results} 로 돌려준다 — 실패를 성공으로 보고하지 않도록 확인을 지시한다.
  it('update_issue 결과의 ok·results.content 를 확인해 상태 변경 실패를 성공으로 말하지 않도록 지시한다', () => {
    expect(SYSTEM_PROMPT).toContain('{ok, results}');
    expect(SYSTEM_PROMPT).toContain('ok 가 false');
    expect(SYSTEM_PROMPT).toContain("results.content 가 'failed' 로 시작");
    expect(SYSTEM_PROMPT).toContain('바뀌었다고 말하지 말고');
  });
});
