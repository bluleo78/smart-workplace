package com.workplace.mail.service;

import com.workplace.mail.repository.EmailMessageRepository.AnalysisContext;
import org.springframework.util.StringUtils;

/**
 * 메일 상세의 요약 표시 상태 판정(WP-149, 순수 함수). 표시 = 개인 ?? 공통(현행). 표시할 요약이 없으면 선택 티어의 생략·시도 기록으로 상태를 정하고, 둘 다
 * 없으면 지금 생성해야 한다(GENERATE).
 *
 * <p>생략도 "시도함"으로 친다 — 개인 요약 생략은 ai_personal_summarized_at 을 남기지 않아, 시도 시각만 보면 매 GET 마다 다시 생성하게 된다.
 * 새 본문이 400자 이하로 짧아 생략한 메일은 버튼도 숨긴다(EMPTY) — 웹은 인용 제거를 재현할 수 없어 서버가 정한다.
 */
public final class MailSummaryDecider {

  /** 판정 결과. GENERATE 는 응답이 아니라 "지금 분석하라"는 내부 신호. */
  public enum Decision {
    READY,
    SKIPPED,
    EMPTY,
    GENERATE
  }

  /** 판정 입력. contentAttempted 는 생략 시에도 true(③ 은 생략해도 시도 시각을 남김). */
  public record State(
      boolean personalTier,
      String personalSummary,
      String contentSummary,
      boolean personalAttempted,
      boolean personalSkipped,
      boolean contentAttempted,
      boolean contentSkipped,
      int newBodyLength) {}

  /** 판정 + 표시 텍스트(READY 일 때만). */
  public record Outcome(Decision decision, String text) {}

  private MailSummaryDecider() {}

  /** 상태 판정. */
  public static Outcome decide(State s) {
    String display =
        StringUtils.hasText(s.personalSummary())
            ? s.personalSummary()
            : (StringUtils.hasText(s.contentSummary()) ? s.contentSummary() : null);
    if (display != null) {
      return new Outcome(Decision.READY, display);
    }
    boolean skipped = s.personalTier() ? s.personalSkipped() : s.contentSkipped();
    boolean attempted = s.personalTier() ? s.personalAttempted() : s.contentAttempted();
    if (skipped) {
      return new Outcome(
          s.newBodyLength() > MailAnalysisService.SUMMARY_MIN_CHARS
              ? Decision.SKIPPED
              : Decision.EMPTY,
          null);
    }
    if (attempted) {
      return new Outcome(Decision.EMPTY, null);
    }
    return new Outcome(Decision.GENERATE, null);
  }

  /** 분석 컨텍스트 → 판정 입력(새 본문 길이 포함). */
  public static State stateOf(AnalysisContext ctx, boolean personalTier) {
    // 새 본문 길이 — 분석 서비스와 같은 추출 결과(MailAnalysisService.newBody)로 400자 기준을 판정한다
    int len = MailAnalysisService.newBody(ctx).length();
    return new State(
        personalTier,
        ctx.personalSummary(),
        ctx.contentSummary(),
        ctx.personalAttempted(),
        ctx.personalSummarySkipped(),
        ctx.contentAttempted(),
        ctx.contentSummarySkipped(),
        len);
  }
}
