package com.workplace.airun.capacity;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI 현황 설정(WP-1830) — {@code workplace.ai-status.*}.
 *
 * @param queueLabels AI 대기열로 보는 라벨 이름 목록. 대기열 이름은 프로젝트마다 달라 코드에 박지 않고 설정으로 받는다. null·빈 값이면 {@link
 *     #DEFAULT_QUEUE_LABEL} 하나.
 */
@ConfigurationProperties("workplace.ai-status")
public record AiStatusProperties(List<String> queueLabels) {

  /** 기본 대기열 라벨 — 프로젝트 관례(work-loop 의 대기열 라벨)와 같다. */
  static final String DEFAULT_QUEUE_LABEL = "AI 개발팀";

  public AiStatusProperties {
    if (queueLabels == null || queueLabels.isEmpty()) {
      queueLabels = List.of(DEFAULT_QUEUE_LABEL);
    }
  }
}
