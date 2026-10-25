package com.workplace.issue.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/**
 * 이슈 관계 걸기 요청(WP-887).
 *
 * @param typeId 관계 유형 id — 차단(BLOCKS)·외부 전용·숨긴 유형은 거절된다
 * @param side 이 이슈가 A 쪽({@code "source"}, 기본)인지 B 쪽({@code "target"})인지. 방향 없는 유형은 값과 무관하게 정규화된다
 * @param target 상대 이슈
 */
public record AddIssueRelationRequest(
    @NotNull Long typeId, String side, @NotNull @Valid Target target) {

  /**
   * 상대 이슈 주소.
   *
   * @param projectKey 상대 프로젝트 키 — null·빈 값이면 주소 이슈와 같은 프로젝트
   * @param number 상대 이슈 번호
   */
  public record Target(String projectKey, @NotNull @Positive Integer number) {}
}
