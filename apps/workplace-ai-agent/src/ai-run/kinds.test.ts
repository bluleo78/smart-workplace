import { describe, expect, it } from 'vitest';
import { AI_RUN_EVENT_KINDS, AI_RUN_ROUTE_KINDS, kindForEvent, kindForPath } from './kinds.js';

// 종류 코드 표 검증 (WP-1828)
describe('종류 코드 표', () => {
  it('경로 28개·이벤트 8개, 값은 대문자 SNAKE, 고유 값 33개', () => {
    expect(Object.keys(AI_RUN_ROUTE_KINDS)).toHaveLength(28);
    expect(Object.keys(AI_RUN_EVENT_KINDS)).toHaveLength(8);
    const values = [...Object.values(AI_RUN_ROUTE_KINDS), ...Object.values(AI_RUN_EVENT_KINDS)];
    for (const v of values) expect(v).toMatch(/^[A-Z][A-Z0-9_]{0,47}$/);
    expect(new Set(values).size).toBe(33);
  });

  it('경로 표·이벤트 표가 설계 표와 정확히 같다', () => {
    expect({ ...AI_RUN_ROUTE_KINDS }).toEqual({
      '/ai/chat': 'AI_CHAT',
      '/home/priority-classify': 'HOME_PRIORITY_CLASSIFY',
      '/home/context-summary': 'HOME_CONTEXT_SUMMARY',
      '/home/suggestions': 'HOME_SUGGESTIONS',
      '/home/memory-cleanup': 'HOME_MEMORY_CLEANUP',
      '/home/shared-memory-check': 'HOME_SHARED_MEMORY_CHECK',
      '/home/shared-memory-extract': 'HOME_SHARED_MEMORY_EXTRACT',
      '/mail/analyze-content': 'MAIL_ANALYZE_CONTENT',
      '/mail/classify-batch': 'MAIL_CLASSIFY_BATCH',
      '/mail/analyze-personal': 'MAIL_ANALYZE_PERSONAL',
      '/mail/learn-category': 'MAIL_LEARN_CATEGORY',
      '/mail/reply-draft': 'MAIL_REPLY_DRAFT',
      '/mail/compose-draft': 'MAIL_COMPOSE_DRAFT',
      '/mail/draft-coaching': 'MAIL_DRAFT_COACHING',
      '/mail/issue-draft': 'MAIL_ISSUE_DRAFT',
      '/messaging/classify': 'MESSAGING_CLASSIFY',
      '/messaging/catchup': 'MESSAGING_CATCHUP',
      '/wiki/summarize': 'WIKI_SUMMARIZE',
      '/wiki/compose': 'WIKI_COMPOSE',
      '/issue/progress-summary': 'ISSUE_PROGRESS_SUMMARY',
      '/issue/classify': 'ISSUE_CLASSIFY',
      '/issue/work-profile': 'WORK_PROFILE',
      '/issue/project-status': 'PROJECT_STATUS',
      '/issue/project-report': 'PROJECT_REPORT',
      '/issue/personal-report': 'PERSONAL_REPORT',
      '/drive/summarize': 'DRIVE_SUMMARIZE',
      '/drive/security-check': 'DRIVE_SECURITY_CHECK',
      '/drive/overview': 'DRIVE_OVERVIEW',
    });
    expect({ ...AI_RUN_EVENT_KINDS }).toEqual({
      'issue.created': 'ISSUE_AGENT_RUN',
      'issue.assigned': 'ISSUE_AGENT_RUN',
      'issue.commented': 'ISSUE_AGENT_RUN',
      'issue.status_changed': 'ISSUE_AGENT_RUN',
      'issue.recurring_run': 'RECURRING_RUN',
      'issue.recurring_test_run': 'RECURRING_TEST_RUN',
      'chat.message.posted': 'ISSUE_CHAT_REPLY',
      'messaging.message.posted': 'MESSAGING_REPLY',
    });
  });

  it('API 긴 처리 종류 4개가 모두 표에 있다', () => {
    const values = new Set([...Object.values(AI_RUN_ROUTE_KINDS), ...Object.values(AI_RUN_EVENT_KINDS)]);
    for (const k of ['AI_CHAT', 'PROJECT_REPORT', 'PERSONAL_REPORT', 'RECURRING_RUN']) {
      expect(values.has(k)).toBe(true);
    }
  });

  it('경로·이벤트 조회', () => {
    expect(kindForPath('/ai/chat')).toBe('AI_CHAT');
    expect(kindForPath('/issue/project-report')).toBe('PROJECT_REPORT');
    // Express 는 대소문자·끝 슬래시를 무시하므로 같은 종류로 본다.
    expect(kindForPath('/ai/chat/')).toBe('AI_CHAT');
    expect(kindForPath('/Mail/classify-batch')).toBe('MAIL_CLASSIFY_BATCH');
    expect(kindForPath('/')).toBeUndefined();
    expect(kindForPath('/health')).toBeUndefined();
    expect(kindForPath('/models/list')).toBeUndefined();
    expect(kindForPath('/internal/bridge/x')).toBeUndefined();
    expect(kindForPath('constructor')).toBeUndefined();
    expect(kindForEvent('issue.assigned')).toBe('ISSUE_AGENT_RUN');
    expect(kindForEvent('messaging.message.posted')).toBe('MESSAGING_REPLY');
    expect(kindForEvent('nope')).toBeUndefined();
  });
});
