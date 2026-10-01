package com.workplace.mail.dto;

/** 메일 요약 응답(캐시 또는 즉시 생성). WP-149: summary 는 READY 일 때만 값이 있다. */
public record MailSummary(String summary, MailSummaryStatus status) {

  /** 요약 카드. */
  public static MailSummary ready(String summary) {
    return new MailSummary(summary, MailSummaryStatus.READY);
  }

  /** 생략됨 — "AI 요약" 버튼. */
  public static MailSummary skipped() {
    return new MailSummary(null, MailSummaryStatus.SKIPPED);
  }

  /** 보여 줄 요약 없음. */
  public static MailSummary empty() {
    return new MailSummary(null, MailSummaryStatus.EMPTY);
  }
}
