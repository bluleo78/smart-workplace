package com.workplace.issue.outbound.dto;

import java.util.List;

/**
 * ai-agent POST /issue/work-profile 응답 DTO(WP-1485). 건수·비율은 API 가 {@code items} 로 직접 센다 — AI 는 문장과
 * 분류만 낸다.
 *
 * @param summary 2~3문장 요약(해요체)
 * @param skills 역량 태그(정리는 API 가 다시 한다)
 * @param items 이슈별 분류
 */
public record WorkProfileAiResult(String summary, List<String> skills, List<Classified> items) {

  /**
   * 이슈 한 건의 분류.
   *
   * @param key 이슈 키
   * @param task 일 종류(고정 목록 중 하나, 밖이면 API 가 기타로 접는다)
   * @param area 일한 영역(짧은 명사)
   */
  public record Classified(String key, String task, String area) {}
}
