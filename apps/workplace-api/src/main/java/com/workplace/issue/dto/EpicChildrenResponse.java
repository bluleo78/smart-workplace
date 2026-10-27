package com.workplace.issue.dto;

import java.util.List;

/**
 * 이슈(주로 에픽)의 활성 하위 목록 응답(WP-1038). 에픽 하위는 다른 프로젝트에 있을 수 있어, 조회자가 그 프로젝트를 읽을 수 없는 하위는 싣지 않고 수만 알린다 —
 * 진행률(childCount)은 모든 하위를 세므로, 화면이 「보이지 않는 하위 N건」으로 수를 맞출 수 있게 한다.
 *
 * @param items 조회자가 읽을 수 있는 하위(이슈 목록과 같은 응답 모양)
 * @param hiddenCount 읽을 수 없는 프로젝트의 하위 수
 */
public record EpicChildrenResponse(List<IssueResponse> items, int hiddenCount) {}
