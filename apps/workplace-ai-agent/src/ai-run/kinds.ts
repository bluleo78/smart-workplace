/**
 * 경로·이벤트 → AI 처리 종류 코드 표 (WP-1828).
 * 코드는 대문자 SNAKE ≤ 48자. API AiRunStaleSweeper 의 긴 처리 종류
 * (AI_CHAT·PROJECT_REPORT·PERSONAL_REPORT·RECURRING_RUN)와 이름이 같아야 한다.
 */

/** 영역 접두 + 이름 → kind 표를 한 번에 펼치는 보조 함수. */
function area(prefix: string, names: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, kind] of Object.entries(names)) out[`${prefix}/${name}`] = kind;
  return out;
}

/** HTTP 경로(정확 일치) → kind. 표에 없는 경로는 기록하지 않는다. */
export const AI_RUN_ROUTE_KINDS: Readonly<Record<string, string>> = Object.freeze({
  '/ai/chat': 'AI_CHAT',
  ...area('/home', {
    'priority-classify': 'HOME_PRIORITY_CLASSIFY',
    'context-summary': 'HOME_CONTEXT_SUMMARY',
    suggestions: 'HOME_SUGGESTIONS',
    'memory-cleanup': 'HOME_MEMORY_CLEANUP',
    'shared-memory-check': 'HOME_SHARED_MEMORY_CHECK',
    'shared-memory-extract': 'HOME_SHARED_MEMORY_EXTRACT',
  }),
  ...area('/mail', {
    'analyze-content': 'MAIL_ANALYZE_CONTENT',
    'classify-batch': 'MAIL_CLASSIFY_BATCH',
    'analyze-personal': 'MAIL_ANALYZE_PERSONAL',
    'learn-category': 'MAIL_LEARN_CATEGORY',
    'reply-draft': 'MAIL_REPLY_DRAFT',
    'compose-draft': 'MAIL_COMPOSE_DRAFT',
    'draft-coaching': 'MAIL_DRAFT_COACHING',
    'issue-draft': 'MAIL_ISSUE_DRAFT',
  }),
  ...area('/messaging', {
    classify: 'MESSAGING_CLASSIFY',
    catchup: 'MESSAGING_CATCHUP',
  }),
  ...area('/wiki', {
    summarize: 'WIKI_SUMMARIZE',
    compose: 'WIKI_COMPOSE',
  }),
  ...area('/issue', {
    'progress-summary': 'ISSUE_PROGRESS_SUMMARY',
    classify: 'ISSUE_CLASSIFY',
    'work-profile': 'WORK_PROFILE',
    'project-status': 'PROJECT_STATUS',
    'project-report': 'PROJECT_REPORT',
    'personal-report': 'PERSONAL_REPORT',
  }),
  ...area('/drive', {
    summarize: 'DRIVE_SUMMARIZE',
    'security-check': 'DRIVE_SECURITY_CHECK',
    overview: 'DRIVE_OVERVIEW',
  }),
});

/** /events envelope 종류 → kind. */
export const AI_RUN_EVENT_KINDS: Readonly<Record<string, string>> = Object.freeze({
  'issue.created': 'ISSUE_AGENT_RUN',
  'issue.assigned': 'ISSUE_AGENT_RUN',
  'issue.commented': 'ISSUE_AGENT_RUN',
  'issue.status_changed': 'ISSUE_AGENT_RUN',
  'issue.recurring_run': 'RECURRING_RUN',
  'issue.recurring_test_run': 'RECURRING_TEST_RUN',
  'chat.message.posted': 'ISSUE_CHAT_REPLY',
  'messaging.message.posted': 'MESSAGING_REPLY',
});

/** 조회용 Map — 객체 prototype 키(constructor 등)가 걸리지 않는다. */
const ROUTE_MAP = new Map(Object.entries(AI_RUN_ROUTE_KINDS));
const EVENT_MAP = new Map(Object.entries(AI_RUN_EVENT_KINDS));

/**
 * 경로의 종류 코드. 표에 없으면 undefined.
 * 정확히 맞는 경로를 먼저 보고, 못 찾을 때만 Express 라우팅처럼 대소문자·끝 슬래시 하나를 무시해 다시 찾는다(WP-1828).
 */
export function kindForPath(path: string): string | undefined {
  const exact = ROUTE_MAP.get(path);
  if (exact) return exact;
  let p = path.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return ROUTE_MAP.get(p);
}

/** 이벤트 종류의 종류 코드. 표에 없으면 undefined. */
export function kindForEvent(type: string): string | undefined {
  return EVENT_MAP.get(type);
}
