import { describe, expect, it } from 'vitest';
import { createIssueFromMailInput } from './mail-tools.js';
import { addCommentInput, createIssueInput, editCommentInput, updateIssueInput } from './schemas.js';

// WP-885: 이슈 본문·코멘트 상한은 API IssueTextLimits.BODY_MAX 와 같은 5만자 — Jira 이전 데이터(본문 2.5만자·코멘트 3.1만자)를 도구로 옮길 수 있어야 한다.
describe('이슈 본문·코멘트 길이 상한', () => {
  const max = '가'.repeat(50000);
  const over = '가'.repeat(50001);

  it('create_issue·update_issue 본문 5만자 허용, 넘으면 거절', () => {
    expect(createIssueInput.safeParse({ projectKey: 'WP', title: 't', body: max }).success).toBe(true);
    expect(createIssueInput.safeParse({ projectKey: 'WP', title: 't', body: over }).success).toBe(false);
    expect(updateIssueInput.safeParse({ issueKey: 'WP-1', body: max }).success).toBe(true);
    expect(updateIssueInput.safeParse({ issueKey: 'WP-1', body: over }).success).toBe(false);
  });

  it('create_issue_from_mail 본문(이슈 본문이 된다)도 5만자 허용, 넘으면 거절', () => {
    const base = { messageId: 1, projectKey: 'WP', title: 't' };
    expect(createIssueFromMailInput.safeParse({ ...base, body: max }).success).toBe(true);
    expect(createIssueFromMailInput.safeParse({ ...base, body: over }).success).toBe(false);
  });

  it('add_comment·update_comment 본문 5만자 허용, 넘으면 거절', () => {
    expect(addCommentInput.safeParse({ issueKey: 'WP-1', body: max }).success).toBe(true);
    expect(addCommentInput.safeParse({ issueKey: 'WP-1', body: over }).success).toBe(false);
    expect(editCommentInput.safeParse({ issueKey: 'WP-1', commentId: 1, body: max }).success).toBe(true);
    expect(editCommentInput.safeParse({ issueKey: 'WP-1', commentId: 1, body: over }).success).toBe(false);
  });
});
