package com.workplace.component.dto;

import com.workplace.global.dto.UserSummary;

/**
 * 구성요소 한 건의 응답(WP-933).
 *
 * @param defaultAssignee 자동 지정에 쓰는 담당자(없으면 null). 무효가 돼도 값은 남겨 설정 화면이 경고를 그릴 수 있게 한다
 * @param defaultAssigneeValid 담당자가 지금도 「프로젝트 멤버 + 활성 + 사람」인가. 담당자가 없으면 문제가 없으므로 true
 * @param issueCount 이 구성요소가 붙은 (삭제되지 않은) 이슈 수
 */
public record ComponentResponse(
    long id,
    String name,
    String description,
    UserSummary defaultAssignee,
    boolean defaultAssigneeValid,
    boolean archived,
    int issueCount) {}
