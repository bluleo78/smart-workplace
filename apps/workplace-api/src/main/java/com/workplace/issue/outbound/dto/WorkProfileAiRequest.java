package com.workplace.issue.outbound.dto;

import java.util.List;

/**
 * ai-agent POST /issue/work-profile 요청 DTO(WP-1485) — 한 사람이 기간 안에 끝낸 이슈(최대 100건)를 보내 요약·역량·이슈별 분류를
 * 받는다. 필드 이름은 ai-agent 의 workProfileInputSchema 와 1:1 이다.
 *
 * @param periodLabel 프롬프트에 쓰는 기간 이름(이번 주 / 이번 달 / 최근 3개월)
 * @param issues 끝낸 이슈(닫힌 시각 내림차순)
 * @param assistantAgentId 분석에 쓸 AI 비서 사용자 id
 * @param model 비서 모델
 * @param maxTurns 비서 최대 턴
 * @param timeoutMs 비서 타임아웃(ms)
 */
public record WorkProfileAiRequest(
    String periodLabel,
    List<Item> issues,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {

  /**
   * 이슈 한 건 — 본문·마지막 코멘트는 API 가 잘라서 보낸다(프롬프트 크기 상한).
   *
   * @param key 이슈 키(예: WP-12) — 응답 분류를 이 키로 짝짓는다
   * @param dueResult 마감 결과(제때 / 늦음 n일 / 마감 없음)
   */
  public record Item(
      String key,
      String title,
      String body,
      String type,
      List<String> labels,
      String epic,
      String project,
      List<String> components,
      String lastComment,
      String dueResult) {}
}
