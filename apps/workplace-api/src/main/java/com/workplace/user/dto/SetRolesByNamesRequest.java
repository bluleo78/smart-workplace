package com.workplace.user.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * 역할명 기반 역할 교체 요청 (#833) — AI 확인 카드 경로 전용.
 *
 * <p>에이전트는 roleId 를 모르고, 역할 목록 조회에는 role:read 가 필요해 에이전트 권한을 넓히게 된다. 그래서 이름으로 받고 해석은 서버가 한다.
 */
public record SetRolesByNamesRequest(@NotNull Long userId, @NotEmpty List<String> roles) {}
