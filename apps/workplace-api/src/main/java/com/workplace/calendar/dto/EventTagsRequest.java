package com.workplace.calendar.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 일정의 내 태그를 이 id 집합으로 바꾸는 요청(WP-714) — 부분 갱신이 아니라 교체라 연속 토글이 응답 순서에 흔들리지 않는다.
 *
 * @param tagIds 붙일 태그 id(모두 호출자 것이어야 함). 빈 목록이면 내 태그를 모두 뗀다. 한 일정에 50개면 충분해 상한을 둔다.
 */
public record EventTagsRequest(@NotNull @Size(max = 50) List<Long> tagIds) {}
