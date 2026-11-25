package com.workplace.issue.workflow.dto;

import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 담당 지정 미리보기 요청(WP-2120) — 저장하기 전에 이 담당 목록이 워크플로우를 시작시킬지 묻는다.
 *
 * @param userIds 지정하려는 담당 전체 목록(저장하지 않는다)
 * @param current 참이면 userIds 를 지금 담당으로 보고 「지금 담당으로 시작될 수 있는가」를 묻는다(카드용, WP-2120 코드 리뷰). 없거나 거짓이면
 *     팝오버처럼 지금 담당을 뺀 사람만 새로 더한 사람으로 본다
 */
public record AssignPreviewRequest(@NotNull List<@NotNull Long> userIds, Boolean current) {}
