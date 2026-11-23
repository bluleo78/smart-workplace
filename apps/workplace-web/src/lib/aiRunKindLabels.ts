// AI 처리 종류 코드 → 화면 이름(WP-1825) — 서버 AiRunKinds.java 의 28개 코드와 위임 작업(DELEGATED_WORK)을 짧은 명사형으로 옮긴다.
// 모르는 코드는 코드 그대로 보여 새 종류가 생겨도 화면이 깨지지 않게 한다.

/** 종류 코드별 화면 이름 — 필터 목록의 표시 순서도 이 순서를 따른다. */
export const AI_RUN_KIND_LABELS: Record<string, string> = {
  AI_CHAT: 'AI 채팅 응답',
  HOME_PRIORITY_CLASSIFY: '홈 우선순위 분류',
  HOME_CONTEXT_SUMMARY: '홈 맥락 요약',
  HOME_SUGGESTIONS: '홈 제안',
  HOME_MEMORY_CLEANUP: '메모리 정리',
  HOME_SHARED_MEMORY_CHECK: '공유 메모리 점검',
  HOME_SHARED_MEMORY_EXTRACT: '공유 메모리 추출',
  MAIL_ANALYZE_CONTENT: '메일 내용 분석',
  MAIL_CLASSIFY_BATCH: '메일 분류',
  MAIL_ANALYZE_PERSONAL: '메일 개인 분석',
  MAIL_LEARN_CATEGORY: '메일 분류 학습',
  MAIL_REPLY_DRAFT: '메일 답장 초안',
  MAIL_COMPOSE_DRAFT: '메일 작성 초안',
  MAIL_DRAFT_COACHING: '메일 초안 코칭',
  MAIL_ISSUE_DRAFT: '메일 이슈 초안',
  MESSAGING_CLASSIFY: '채팅 분류',
  MESSAGING_CATCHUP: '채팅 따라잡기',
  WIKI_SUMMARIZE: '노트 요약',
  WIKI_COMPOSE: '노트 작성',
  ISSUE_PROGRESS_SUMMARY: '이슈 진행 요약',
  ISSUE_CLASSIFY: '이슈 분류',
  WORK_PROFILE: '업무 프로필',
  PROJECT_STATUS: '프로젝트 현황',
  PROJECT_REPORT: '프로젝트 리포트',
  PERSONAL_REPORT: '개인 리포트',
  DRIVE_SUMMARIZE: '파일 요약',
  DRIVE_SECURITY_CHECK: '파일 보안 점검',
  DRIVE_OVERVIEW: '드라이브 개요',
  DELEGATED_WORK: '위임 작업',
}

/** 종류 코드 → 화면 이름. 모르는 코드는 코드 그대로. */
export function aiRunKindLabel(code: string): string {
  return AI_RUN_KIND_LABELS[code] ?? code
}

/** 종류 필터 선택지 — 위 표의 순서. */
export const AI_RUN_KIND_OPTIONS: { value: string; label: string }[] = Object.entries(AI_RUN_KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
)
