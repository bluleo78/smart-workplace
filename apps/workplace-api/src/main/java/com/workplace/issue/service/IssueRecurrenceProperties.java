package com.workplace.issue.service;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 반복 AI 작업 설정(WP-1407). {@code workplace.issue-recurrence} 키로 바인딩한다(@ConfigurationPropertiesScan).
 *
 * <p>pendingTimeout 은 보낸 회차(정기 회차·이어 처리·테스트 실행)의 결과를 기다리는 시간이다 — 넘으면 결과를 못 받은 실행으로 정리한다(정기 회차는 실패로
 * 센다). ai-agent 의 반복 실행 상한({@code WORKPLACE_AI_RECURRING_TIMEOUT_MS}, 기본 30분)에 결과 보고 재시도(약 4분)를 더한
 * 것보다 길어야 한다 — 짧으면 상한 안에 끝난 회차도 결과가 오기 전에 「결과를 받지 못했습니다」로 실패를 센다. ai-agent 상한을 바꿀 때 함께 바꾼다.
 */
@ConfigurationProperties("workplace.issue-recurrence")
public record IssueRecurrenceProperties(Duration pendingTimeout) {

  /** 결과 대기 기본값 — ai-agent 반복 상한 30분 + 보고 재시도 약 4분 + 여유. */
  public static final Duration DEFAULT_PENDING_TIMEOUT = Duration.ofMinutes(40);

  /** 미설정·0 이하 값이면 기본값(40분). */
  public IssueRecurrenceProperties {
    if (pendingTimeout == null || pendingTimeout.isZero() || pendingTimeout.isNegative()) {
      pendingTimeout = DEFAULT_PENDING_TIMEOUT;
    }
  }
}
