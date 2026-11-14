package com.workplace.cycle.dto;

/**
 * 사이클 완료 응답(WP-1578). 완료된 사이클과 필요 시 새로 만든 사이클 정보를 돌려준다.
 *
 * @param completedCycle 완료 처리된 사이클 정보 (항상 포함)
 * @param newCycle 새로 만든 사이클 정보 (destination=NEW일 때만, 그 외 null)
 */
public record CycleCompleteResponse(CycleResponse completedCycle, CycleResponse newCycle) {}
