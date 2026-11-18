package com.workplace.mail.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 메일 사용자 설정 저장 요청(WP-1744). 값이 없으면(null) 400, {@link MailComposePlacement} 에 없는 값도 400.
 *
 * @param composeMode 새 작성을 열 곳
 */
public record MailUserSettingUpdateRequest(@NotNull MailComposePlacement composeMode) {}
