package com.workplace.agentruntime.dto;

import java.time.OffsetDateTime;

/**
 * desired 응답의 비밀값 참조(WP-1249) — 원문 없이 이름·출처·버전만. runner 는 version 이 자기 Secret 과 다를 때만 원문을 다시 받는다.
 *
 * @param name 비밀값 이름(agent-key·claude·github)
 * @param source WORKS(원문은 Works 의 runner 전용 엔드포인트에서) 또는 LOCATION(runner 설치 때 위치 쪽에 만든 Secret —
 *     Works 는 이름만 안다)
 * @param version Works 쪽 버전(없으면 null — LOCATION 은 늘 null)
 * @param rotateAfter 이 시각이 지나면 다시 받는다(agent-key 만)
 */
public record RunnerSecretRef(
    String name, String source, Long version, OffsetDateTime rotateAfter) {

  /** 출처 — Works 가 원문을 준다. */
  public static final String SOURCE_WORKS = "WORKS";

  /** 출처 — 실행 위치 쪽 Secret(Works 는 원문을 모른다). */
  public static final String SOURCE_LOCATION = "LOCATION";
}
