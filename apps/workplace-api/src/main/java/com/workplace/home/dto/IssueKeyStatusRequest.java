package com.workplace.home.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 이슈 키 상태 일괄 조회 요청(WP-2102). 한 번에 최대 100개 — 넘으면 Bean Validation 이 400 으로 거절한다.
 *
 * @param keys 이슈 키 목록(예: WP-12)
 */
public record IssueKeyStatusRequest(@NotNull @Size(max = 100) List<String> keys) {}
