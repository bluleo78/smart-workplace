package com.workplace.help.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 0건 검색 기록 요청(WP-1512). 2000자 상한은 남용 차단용이고, 200자를 넘는 값은 서비스가 자른다.
 *
 * @param query 검색어(공백뿐이면 기록하지 않음)
 * @param route 검색한 화면 경로
 * @param helpId 도움말 id(없을 수 있음)
 */
public record HelpSearchMissMetricRequest(
    @Size(max = 2000) String query,
    @NotBlank @Size(max = 2000) String route,
    @Size(max = 200) String helpId) {}
