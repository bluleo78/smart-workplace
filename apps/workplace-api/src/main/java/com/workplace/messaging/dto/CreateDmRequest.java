package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/** DM 생성 요청. userIds 는 본인 제외 타겟(서비스에서 caller 합집합·검증). */
public record CreateDmRequest(@NotEmpty List<Long> userIds) {}
