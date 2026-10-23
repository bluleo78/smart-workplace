import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIssueFromMailInput } from './mail-tools.js';
import { createIssueInput, ISSUE_PRIORITIES, issueListFilterShape, updateIssueInput } from './schemas.js';

// WP-886: 우선순위는 모든 프로젝트 공통 5단계(API IssuePriorities·DB CHECK V211 와 같다). 도구 입력이 5단계를 모두 받고,
// 그 밖의 값(URGENT·한국어 「높음」·소문자)은 서버까지 가기 전에 거절해야 LLM 이 사용 가능 값으로 고쳐 다시 부른다.
describe('이슈 우선순위 5단계', () => {
  const five = ['HIGHEST', 'HIGH', 'MID', 'LOW', 'LOWEST'];
  const invalid = ['URGENT', '높음', 'high', 'MEDIUM'];

  it('공용 목록은 표시 순서(매우 높음 → 매우 낮음)다', () => {
    expect([...ISSUE_PRIORITIES]).toEqual(five);
  });

  it('create_issue·update_issue·create_issue_from_mail 은 5단계를 받고 다른 값은 거절한다', () => {
    for (const priority of five) {
      expect(createIssueInput.safeParse({ projectKey: 'WP', title: 't', priority }).success).toBe(true);
      expect(updateIssueInput.safeParse({ issueKey: 'WP-1', priority }).success).toBe(true);
      expect(createIssueFromMailInput.safeParse({ messageId: 1, projectKey: 'WP', title: 't', priority }).success).toBe(true);
    }
    for (const priority of invalid) {
      expect(createIssueInput.safeParse({ projectKey: 'WP', title: 't', priority }).success).toBe(false);
      expect(updateIssueInput.safeParse({ issueKey: 'WP-1', priority }).success).toBe(false);
      expect(createIssueFromMailInput.safeParse({ messageId: 1, projectKey: 'WP', title: 't', priority }).success).toBe(false);
    }
  });

  it('목록 필터(list_issues·show_issue_list)의 priority 배열도 5단계만 받는다', () => {
    const filter = z.object(issueListFilterShape);
    expect(filter.safeParse({ priority: ['HIGHEST', 'LOWEST'] }).success).toBe(true);
    expect(filter.safeParse({ priority: ['HIGHEST', 'URGENT'] }).success).toBe(false);
  });
});
