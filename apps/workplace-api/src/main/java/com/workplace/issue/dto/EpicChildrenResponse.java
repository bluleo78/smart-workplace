package com.workplace.issue.dto;

import java.util.List;

/**
 * 이슈(주로 에픽)의 활성 하위 목록 응답(WP-1038). 에픽 하위는 다른 프로젝트에 있을 수 있어, 조회자가 그 프로젝트를 읽을 수 없는 하위는 싣지 않고 수만 알린다 —
 * 진행률(childCount)은 모든 하위를 세므로, 화면이 「보이지 않는 하위 N건」으로 수를 맞출 수 있게 한다.
 *
 * <p>WP-1684 — 상태 조건(open·closed)과 커서 페이징이 붙었다. items 는 고른 상태의 한 페이지이고, 수(hiddenCount·closedCount)는
 * 페이지와 상관없이 그 부모의 하위 전체 기준이라 어느 페이지·어느 상태로 받아도 같다.
 *
 * @param items 조회자가 읽을 수 있는 하위 중 고른 상태의 한 페이지 — (created_at, id) 오름차순(이슈 목록과 같은 응답 모양)
 * @param hiddenCount 읽을 수 없는 프로젝트의 하위 수(열림·끝남 모두)
 * @param closedCount 조회자가 읽을 수 있는 끝난(완료·취소 범주) 하위 수 — 화면의 「완료 n건」
 * @param nextCursor 다음 페이지 커서(불투명 문자열). 마지막 페이지면 null
 */
public record EpicChildrenResponse(
    List<IssueResponse> items, int hiddenCount, int closedCount, String nextCursor) {}
