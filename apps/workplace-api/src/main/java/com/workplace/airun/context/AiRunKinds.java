package com.workplace.airun.context;

import static java.util.Map.entry;

import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * ai-agent 경로 → AI 처리 종류(kind) 코드 표 (WP-1829).
 *
 * <p>값은 apps/workplace-ai-agent/src/ai-run/kinds.ts 의 AI_RUN_ROUTE_KINDS 와 같아야 하며 AiRunKindsTest 가
 * 대조한다. 표에 없는 경로는 kind 를 정하지 않고 기록 대상에서 뺀다.
 */
public final class AiRunKinds {

  /** 처리 종류 — 프로젝트 리포트(경로 /issue/project-report 와 같은 값). 건너뜀 기록(AiRunSkips)도 이 표를 쓴다. */
  public static final String PROJECT_REPORT = "PROJECT_REPORT";

  /** 처리 종류 — 개인 보고(경로 /issue/personal-report 와 같은 값). */
  public static final String PERSONAL_REPORT = "PERSONAL_REPORT";

  private static final Map<String, String> ROUTE_KINDS =
      Map.ofEntries(
          entry("/ai/chat", "AI_CHAT"),
          entry("/home/priority-classify", "HOME_PRIORITY_CLASSIFY"),
          entry("/home/context-summary", "HOME_CONTEXT_SUMMARY"),
          entry("/home/suggestions", "HOME_SUGGESTIONS"),
          entry("/home/memory-cleanup", "HOME_MEMORY_CLEANUP"),
          entry("/home/shared-memory-check", "HOME_SHARED_MEMORY_CHECK"),
          entry("/home/shared-memory-extract", "HOME_SHARED_MEMORY_EXTRACT"),
          entry("/mail/analyze-content", "MAIL_ANALYZE_CONTENT"),
          entry("/mail/classify-batch", "MAIL_CLASSIFY_BATCH"),
          entry("/mail/analyze-personal", "MAIL_ANALYZE_PERSONAL"),
          entry("/mail/learn-category", "MAIL_LEARN_CATEGORY"),
          entry("/mail/reply-draft", "MAIL_REPLY_DRAFT"),
          entry("/mail/compose-draft", "MAIL_COMPOSE_DRAFT"),
          entry("/mail/draft-coaching", "MAIL_DRAFT_COACHING"),
          entry("/mail/issue-draft", "MAIL_ISSUE_DRAFT"),
          entry("/messaging/classify", "MESSAGING_CLASSIFY"),
          entry("/messaging/catchup", "MESSAGING_CATCHUP"),
          entry("/wiki/summarize", "WIKI_SUMMARIZE"),
          entry("/wiki/compose", "WIKI_COMPOSE"),
          entry("/issue/progress-summary", "ISSUE_PROGRESS_SUMMARY"),
          entry("/issue/classify", "ISSUE_CLASSIFY"),
          entry("/issue/work-profile", "WORK_PROFILE"),
          entry("/issue/project-status", "PROJECT_STATUS"),
          entry("/issue/project-report", PROJECT_REPORT),
          entry("/issue/personal-report", PERSONAL_REPORT),
          entry("/drive/summarize", "DRIVE_SUMMARIZE"),
          entry("/drive/security-check", "DRIVE_SECURITY_CHECK"),
          entry("/drive/overview", "DRIVE_OVERVIEW"));

  private AiRunKinds() {}

  /** 경로의 kind. 앞뒤 공백·쿼리 문자열을 빼고 대소문자를 무시하며 끝 '/' 하나를 허용한다(ai-agent kindForPath 와 같은 규칙). */
  public static Optional<String> kindForPath(String path) {
    if (path == null) {
      return Optional.empty();
    }
    String p = path.strip();
    int q = p.indexOf('?');
    if (q >= 0) {
      p = p.substring(0, q);
    }
    p = p.toLowerCase(Locale.ROOT);
    if (p.length() > 1 && p.endsWith("/")) {
      p = p.substring(0, p.length() - 1);
    }
    return Optional.ofNullable(ROUTE_KINDS.get(p));
  }

  /** 경로 → kind 표 전체(읽기 전용). ai-agent 표와의 대조 테스트용. */
  public static Map<String, String> routeKinds() {
    return ROUTE_KINDS;
  }
}
