package com.workplace.help.dto;

import java.time.OffsetDateTime;

/**
 * 도움말 지표 상위 목록의 한 행(WP-1512). 집계 기간 합계이며, 그룹에 쓰지 않은 컬럼은 빈 문자열이다.
 *
 * @param route 화면 경로(OPEN 집계에서만 의미)
 * @param helpId 도움말 id
 * @param term 검색어(SEARCH_MISS·AI_GAP 집계에서만 의미)
 * @param count 기간 합계 건수
 * @param lastAt 기간 내 마지막 발생 시각
 */
public record HelpMetricRow(
    String route, String helpId, String term, long count, OffsetDateTime lastAt) {}
