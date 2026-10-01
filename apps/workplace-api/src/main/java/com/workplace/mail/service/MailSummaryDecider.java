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

  /** 판정 + 표시 텍스트(READY 일 때만). */
  public record Outcome(Decision decision, String text) {}

  private MailSummaryDecider() {}

  /** 표시 규칙 — 개인 요약 우선, 없으면 공통 요약. 둘 다 없으면 null. */
  public static String display(AnalysisContext ctx) {
    if (StringUtils.hasText(ctx.personalSummary())) {
      return ctx.personalSummary();
    }
    return StringUtils.hasText(ctx.contentSummary()) ? ctx.contentSummary() : null;
  }

  /** 상태 판정. 새 본문 길이는 생략 분기에서만 추출한다(분석 서비스와 같은 {@code MailAnalysisService.newBody}, 400자 기준). */
  public static Outcome decide(AnalysisContext ctx, boolean personalTier) {
    String display = display(ctx);
    if (display != null) {
      return new Outcome(Decision.READY, display);
    }
    boolean skipped = personalTier ? ctx.personalSummarySkipped() : ctx.contentSummarySkipped();
    boolean attempted = personalTier ? ctx.personalAttempted() : ctx.contentAttempted();
    if (skipped) {
      return new Outcome(
          MailAnalysisService.newBody(ctx).length() > MailAnalysisService.SUMMARY_MIN_CHARS
              ? Decision.SKIPPED
              : Decision.EMPTY,
          null);
    }
    if (attempted) {
      return new Outcome(Decision.EMPTY, null);
    }
    return new Outcome(Decision.GENERATE, null);
  }
}
