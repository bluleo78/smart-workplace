// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { clearIssueBodyDrafts, issueBodyDraftKey } from './issueBodyDraft';

// 이슈 본문 로컬 초안 — 같은 기기의 다른 사용자·워크스페이스에 보이지 않아야 한다(WP-699).
describe('issueBodyDraftKey', () => {
  it('사용자·워크스페이스마다 다른 키를 쓴다', () => {
    const a = issueBodyDraftKey({ userId: 1, tenantId: 10 }, 'DR', 1);
    expect(a).not.toBe(issueBodyDraftKey({ userId: 2, tenantId: 10 }, 'DR', 1));
    expect(a).not.toBe(issueBodyDraftKey({ userId: 1, tenantId: 11 }, 'DR', 1));
    expect(a).not.toBe(issueBodyDraftKey({ userId: 1, tenantId: 10 }, 'DR', 2));
  });
});

describe('clearIssueBodyDrafts', () => {
  beforeEach(() => localStorage.clear());

  it('로그아웃 정리 — 본문 초안(예전 형식 키 포함)만 지우고 다른 저장값은 둔다', () => {
    localStorage.setItem(issueBodyDraftKey({ userId: 1, tenantId: 10 }, 'DR', 1), '내 초안');
    localStorage.setItem('issue-body-draft:DR:1', '예전 키 초안');
    localStorage.setItem('theme', 'dark');
    clearIssueBodyDrafts();
    expect(Object.keys(localStorage)).toEqual(['theme']);
  });
});
