package com.workplace.airun.status.dto;

import java.time.Instant;
import java.util.List;

/**
 * 처리 이력 목록 필터(WP-1831). 비어 있는 값은 「거르지 않음」이다. 값 검증은 서비스가 한다.
 *
 * @param kinds 종류 코드 목록(DELEGATED_WORK 가 없으면 위임 작업 제외). null·빈 목록이면 전부
 * @param status RUNNING·SUCCEEDED·FAILED·SKIPPED(위임 작업은 대응 상태로)
 * @param actorType AUTO·USER·AGENT
 * @param model 모델 이름(위임 작업은 모델이 없어 제외)
 * @param q 대상 표시 글·오류 사유(위임 작업은 이슈 제목·키) 부분 일치 검색어, 대소문자 무시
 * @param from 시작 시각 하한(포함)
 * @param to 시작 시각 상한(미포함)
 */
public record AiRunFilter(
    List<String> kinds,
    String status,
    String actorType,
    String model,
    String q,
    Instant from,
    Instant to) {}
