package com.workplace.airun;

import java.time.Duration;

/**
 * ai-agent 로 보내는 AI 호출 지점별 실행 상한 표 (WP-2111).
 *
 * <p>공통 60초로 끊으면 정상이지만 느린 실행이 버려지므로, 호출 지점마다 실측(p99 약 2배 올림, 최소 60초) 근거의 기본 상한을 한 곳에 둔다. 사람이 화면에서
 * 기다리는 동기 호출은 길게 만들지 않고 현재 값을 유지한다. 배포에서는 {@link AiCallTimeouts} 가 환경변수로 덮어쓴다.
 *
 * <p>덮어쓰기 최대(maxOverride)는 그 호출을 돌리는 가장 짧은 소비자(리스·예약·잠금·대기)보다 짧게 둔다. 특별한 소비자가 없는 백그라운드·초안 항목은 10분 —
 * 잠금 아래 회차는 {@link RoundDeadline} 이 다음 호출 전에 끊지만, 한 호출 자체가 기본 잠금(30분)을 넘지 않게 한다. 항목별 사유는 각 항목 주석.
 *
 * <p>한 종류(kind)에 성격이 다른 호출 지점이 있으면 항목을 나눈다(추천·공용 메모리 검사). kind 는 {@code AiRunKinds} 의 종류 코드와 같다.
 */
public enum AiCall {
  /**
   * 대화형 AI 채팅. 기존 하한 180초(옛 HomeChatService.COMPOSE_MIN_TIMEOUT_MS) 유지 — 느린 도구를 거친다. 덮어쓰기 최대는 4분 —
   * ai-agent run-ai-chat.ts 의 REQUEST_BUDGET_MS(290초)가 한도 도달 뒤 마무리 답 호출을 그 예산 안에서만 하므로, 상한+여유(30초)가
   * 290초를 넘으면 마무리 답이 빠진다(240+30=270초).
   */
  AI_CHAT("AI_CHAT", Duration.ofSeconds(180), Duration.ofMinutes(4)),

  /** 홈 우선순위 분류(백그라운드). 입력이 커서 60초를 넘는 실행이 잦다. */
  HOME_PRIORITY_CLASSIFY("HOME_PRIORITY_CLASSIFY", Duration.ofSeconds(120)),

  /** 홈 컨텍스트 요약(백그라운드). */
  HOME_CONTEXT_SUMMARY("HOME_CONTEXT_SUMMARY", Duration.ofSeconds(60)),

  /** 시작 추천 — 사람이 화면에서 기다리는 동기 호출이라 현재 값을 유지한다. */
  HOME_SUGGESTIONS_STARTER("HOME_SUGGESTIONS", Duration.ofSeconds(15), Duration.ofSeconds(60)),

  /** 후속 질문 추천 — 턴 직후 동기 호출이라 현재 값을 유지한다. */
  HOME_SUGGESTIONS_FOLLOWUP("HOME_SUGGESTIONS", Duration.ofSeconds(20), Duration.ofSeconds(60)),

  /** 질문 선택지 추출 — 턴 직후 동기 호출이라 현재 값을 유지한다. */
  HOME_SUGGESTIONS_QUESTION_OPTIONS(
      "HOME_SUGGESTIONS", Duration.ofSeconds(20), Duration.ofSeconds(60)),

  /** AI 메모리 정리(스케줄러). */
  HOME_MEMORY_CLEANUP("HOME_MEMORY_CLEANUP", Duration.ofSeconds(60), Duration.ofSeconds(60)),

  /** 공용 메모리 직접 요청 검사 — 사용자가 응답을 기다리는 동기 호출이라 현재 값을 유지한다. */
  HOME_SHARED_MEMORY_CHECK_REQUEST(
      "HOME_SHARED_MEMORY_CHECK", Duration.ofSeconds(12), Duration.ofSeconds(60)),

  /** 공용 메모리 검사(배치·백그라운드). */
  HOME_SHARED_MEMORY_CHECK_BATCH(
      "HOME_SHARED_MEMORY_CHECK", Duration.ofSeconds(60), Duration.ofSeconds(60)),

  /** 공용 메모리 추출(백그라운드). */
  HOME_SHARED_MEMORY_EXTRACT(
      "HOME_SHARED_MEMORY_EXTRACT", Duration.ofSeconds(60), Duration.ofSeconds(60)),

  /**
   * 메일 본문 분석 — 본문이 길면 60초를 넘는다. 같은 메일을 기다리는 MailAnalysisService 의 SingleFlight 대기는 이 값의 읽기 상한 + 여유로
   * 계산한다(기다리는 쪽이 리더보다 먼저 포기하지 않게).
   */
  MAIL_ANALYZE_CONTENT("MAIL_ANALYZE_CONTENT", Duration.ofSeconds(120)),

  /** 메일 분류 배치 — 여러 건을 한 번에 처리한다. */
  MAIL_CLASSIFY_BATCH("MAIL_CLASSIFY_BATCH", Duration.ofSeconds(120)),

  /** 메일 개인 분석 — SingleFlight 대기 계산은 본문 분석과 같다. */
  MAIL_ANALYZE_PERSONAL("MAIL_ANALYZE_PERSONAL", Duration.ofSeconds(120)),

  /** 메일 분류 학습. */
  MAIL_LEARN_CATEGORY("MAIL_LEARN_CATEGORY", Duration.ofSeconds(60)),

  /** 메일 답장 초안. */
  MAIL_REPLY_DRAFT("MAIL_REPLY_DRAFT", Duration.ofSeconds(60)),

  /** 메일 작성 초안. */
  MAIL_COMPOSE_DRAFT("MAIL_COMPOSE_DRAFT", Duration.ofSeconds(60)),

  /** 메일 초안 코칭. */
  MAIL_DRAFT_COACHING("MAIL_DRAFT_COACHING", Duration.ofSeconds(60)),

  /** 메일 → 이슈 초안. */
  MAIL_ISSUE_DRAFT("MAIL_ISSUE_DRAFT", Duration.ofSeconds(60)),

  /** 팀 채팅 주의 분류. */
  MESSAGING_CLASSIFY("MESSAGING_CLASSIFY", Duration.ofSeconds(60)),

  /** 채널 따라잡기 요약. */
  MESSAGING_CATCHUP("MESSAGING_CATCHUP", Duration.ofSeconds(60)),

  /** 노트 요약. */
  WIKI_SUMMARIZE("WIKI_SUMMARIZE", Duration.ofSeconds(60)),

  /** 노트 작성 보조. */
  WIKI_COMPOSE("WIKI_COMPOSE", Duration.ofSeconds(60)),

  /** 이슈 진행 요약. */
  ISSUE_PROGRESS_SUMMARY("ISSUE_PROGRESS_SUMMARY", Duration.ofSeconds(60)),

  /** 이슈 분류. */
  ISSUE_CLASSIFY("ISSUE_CLASSIFY", Duration.ofSeconds(60)),

  /**
   * 업무 프로필 생성 — 이력 전체를 읽어 오래 걸린다. 덮어쓰기 최대 8분 — WorkProfileService.STALE_PENDING(10분)이 지나면 다른 요청이 같은
   * 프로필을 다시 선점하므로, 상한+읽기 여유(30초)가 그 안에 끝나게 한다.
   */
  WORK_PROFILE("WORK_PROFILE", Duration.ofSeconds(180), Duration.ofMinutes(8)),

  /** 프로젝트 현황. */
  PROJECT_STATUS("PROJECT_STATUS", Duration.ofSeconds(120)),

  /**
   * 프로젝트 리포트 — 긴 생성. 덮어쓰기 최대 20분 — ProjectReportRepository.STALE_PENDING_MINUTES(30분) 예약과 스케줄러
   * 잠금(40분) 안에 한 건이 끝나게 한다(회차는 RoundDeadline 이 다음 건 시작 전에 끊는다).
   */
  PROJECT_REPORT("PROJECT_REPORT", Duration.ofSeconds(180), Duration.ofMinutes(20)),

  /**
   * 개인 보고 — 긴 생성. 덮어쓰기 최대 20분 — PersonalReportRepository.STALE_PENDING_MINUTES(30분) 예약과 스케줄러
   * 잠금(40분) 안에 한 건이 끝나게 한다.
   */
  PERSONAL_REPORT("PERSONAL_REPORT", Duration.ofSeconds(180), Duration.ofMinutes(20)),

  /**
   * 드라이브 파일 요약. 덮어쓰기 최대 8분 — 요약 선점 리스 WorkerJobRepository.SUMMARY_LEASE_DURATION(10분)이 먼저 끝나면 같은
   * 파일을 다시 선점하므로, 상한+읽기 여유가 리스 안에 끝나게 한다(보안 검사와 같은 리스).
   */
  DRIVE_SUMMARIZE("DRIVE_SUMMARIZE", Duration.ofSeconds(60), Duration.ofMinutes(8)),

  /**
   * 드라이브 보안 검사 — 덮어쓰기 최대 8분은 FileSecurityCheckPipeline.MAX_AGENT_TIMEOUT_MS 와 같은 값(저장소 리스 계산이 묶여
   * 있음. 그쪽이 이 값을 끌어다 쓴다).
   */
  DRIVE_SECURITY_CHECK("DRIVE_SECURITY_CHECK", Duration.ofSeconds(60), Duration.ofMinutes(8)),

  /** 드라이브 개요. */
  DRIVE_OVERVIEW("DRIVE_OVERVIEW", Duration.ofSeconds(60));

  private final String kind;
  private final Duration defaultTimeout;
  private final Duration maxOverride;

  /** 덮어쓰기 최대를 따로 안 두는 항목 — 최대 10분(가장 짧은 소비자인 기본 잠금 30분 안). */
  AiCall(String kind, Duration defaultTimeout) {
    this(kind, defaultTimeout, Duration.ofMinutes(10));
  }

  /** 덮어쓰기 최대를 지정하는 예외 항목(소비자가 더 짧은 경우). */
  AiCall(String kind, Duration defaultTimeout, Duration maxOverride) {
    this.kind = kind;
    this.defaultTimeout = defaultTimeout;
    this.maxOverride = maxOverride;
  }

  /** AiRunKinds 의 종류 코드. */
  public String kind() {
    return kind;
  }

  /** 코드 기본 실행 상한. */
  public Duration defaultTimeout() {
    return defaultTimeout;
  }

  /** 덮어쓰기로 허용하는 최대 상한(ai-agent 가 60초 넘게 거절하는 항목은 60초). */
  public Duration maxOverride() {
    return maxOverride;
  }
}
