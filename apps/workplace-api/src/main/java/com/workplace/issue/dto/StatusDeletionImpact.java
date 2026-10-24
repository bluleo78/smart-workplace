package com.workplace.issue.dto;

/**
 * 상태 삭제 영향(WP-809) — 삭제 확인 창이 버튼·경고 문구를 고르는 근거.
 *
 * @param issueCount 이 상태의 활성 이슈 수(휴지통 제외) — 「이슈 N개 옮기고 삭제」와 옮길 상태 필수 여부
 * @param savedViewCount 이 상태를 statusId·boardTab 으로 가리키는 저장된 뷰 수(소유자·공개 범위 무관)
 * @param blockedEpicCount 이 상태의 활성 에픽 중 이 상태가 아닌 미완료 활성 하위가 있는 수 — 대상이 완료 범주이고 이 상태가 완료 범주가 아닐 때만
 *     의미가 있다(그 판정은 웹이 한다). 같은 상태의 하위는 함께 옮겨지므로 세지 않는다.
 * @param emptiedFilterViewCount 이 상태를 빼면 statusId 필터가 비는 저장된 뷰 수 — 이슈 0개 삭제(옮길 대상 없음)에서 「필터가 빠져요」
 *     안내용
 */
public record StatusDeletionImpact(
    int issueCount, int savedViewCount, int blockedEpicCount, int emptiedFilterViewCount) {}
