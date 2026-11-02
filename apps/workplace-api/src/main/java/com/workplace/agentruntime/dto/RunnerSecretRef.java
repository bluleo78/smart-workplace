package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * desired 응답의 비밀값 참조(WP-1249) — 원문 없이 이름·출처·버전만. runner 는 version 이 자기 Secret 과 다를 때만 원문을 다시 받는다.
 *
 * @param name 비밀값 이름(agent-key·claude·repos)
 * @param source 출처(WORKS — 원문은 Works 의 runner 전용 엔드포인트에서)
 * @param version Works 쪽 버전(없으면 null)
 * @param rotateAfter 이 시각이 지나면 다시 받는다(agent-key 만)
 */
public record RunnerSecretRef(
    String name, String source, Long version, OffsetDateTime rotateAfter) {

  /** 출처 — Works 가 원문을 준다. */
  public static final String SOURCE_WORKS = "WORKS";
}
