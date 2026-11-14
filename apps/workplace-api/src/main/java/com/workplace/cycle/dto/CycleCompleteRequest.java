package com.workplace.cycle.dto;

import com.workplace.global.util.SingleLineTitles;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * 사이클 완료 요청 본문(WP-1578). 완료하는 사이클의 미완료 이슈를 보낼 곳(destination)을 고른다.
 *
 * <ul>
 *   <li>NEW — 새 사이클을 진행 중으로 만들어 미완료 이슈를 붙인다. 이름·시작일·종료일 필수(사이클 생성과 같게, WP-1316).
 *   <li>SCHEDULED — 예정(PLANNED) 사이클에 붙인다. targetCycleId 필수, startImmediately 가 없으면 true(대상을 진행
 *       중으로).
 *   <li>NONE — 사이클만 완료한다. 미완료 이슈는 완료된 사이클에 그대로 남는다.
 * </ul>
 *
 * <p>목적지에 쓰이지 않는 항목은 무시한다. 목적지별 필수 검증은 목적지를 푸는 {@code CycleService.complete} 가 한 곳에서 맡는다 — Bean
 * Validation 으로는 「destination 에 따라 필수」를 표현하기 어렵고, 검증 순서(사이클 상태 확인 뒤)도 서비스가 정해서다.
 */
public record CycleCompleteRequest(
    @NotNull(message = "보낼 곳을 골라 주세요") Destination destination,
    Long targetCycleId,
    Boolean startImmediately,
    @Size(max = 60) String newCycleName,
    LocalDate newCycleStartDate,
    LocalDate newCycleEndDate) {

  public CycleCompleteRequest {
    // 새 사이클 이름도 사이클 생성(CreateCycleRequest)처럼 한 줄로 다듬는다(WP-628). 다듬어 비면 CycleService.complete 가 거절한다
    newCycleName = SingleLineTitles.normalize(newCycleName);
  }

  /** 미완료 이슈를 보낼 곳. */
  public enum Destination {
    /** 새 사이클을 만들어 붙인다. */
    NEW,
    /** 예정 사이클에 붙인다. */
    SCHEDULED,
    /** 보내지 않는다 — 사이클만 완료. */
    NONE
  }

  /** SCHEDULED 일 때 대상을 진행 중으로 바꿀지 — 지정하지 않으면 바꾼다(기본 true). */
  public boolean startImmediatelyOrDefault() {
    return startImmediately == null || startImmediately;
  }
}
