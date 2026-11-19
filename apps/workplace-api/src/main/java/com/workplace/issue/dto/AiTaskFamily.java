package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;

/**
 * AI 위임 작업 행의 부모·하위 가족 정보(WP-1800). 같은 묶음 안에서 부모와 그 하위(손자까지 두 단계)가 함께 결과에 있을 때만 싣는다. 값이 없는 필드는 JSON
 * 에서 뺀다.
 *
 * @param headNumber 하위 행에만 — 가족 머리(부모) 행의 이슈 번호
 * @param lastReportAt 가족 머리 행에만 — 가족 진행 중 작업의 가장 최근 보고 시각(없으면 생략)
 * @param stale 가족 머리 행에만 — 머리 자신의 작업이 무소식이고 가족 전체도 2시간 넘게 보고가 없으면 true
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AiTaskFamily(Integer headNumber, Instant lastReportAt, Boolean stale) {}
