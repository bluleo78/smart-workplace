package com.workplace.cycle.dto;

/**
 * 사이클 완료 응답(WP-1578). 완료된 사이클과 미완료 이슈를 보낸 대상 사이클을 돌려준다 — 웹이 완료 뒤 안내(「GW-12 로 3개 보냄」)와 목록 갱신에 쓴다.
 *
 * @param completedCycle 완료 처리된 사이클(항상 있음)
 * @param targetCycle 미완료 이슈를 보낸 사이클 — NEW 면 새로 만든 사이클, SCHEDULED 면 고른 예정 사이클(바로 시작했으면 진행 중), NONE
 *     이면 null
 */
public record CycleCompleteResponse(CycleResponse completedCycle, CycleResponse targetCycle) {}
