package com.workplace.auth.sso.dto;

import jakarta.validation.constraints.NotNull;

/** WP-48 SSO 로그인 켜기/끄기 요청. */
public record UpdateSsoEnabledRequest(@NotNull Boolean enabled) {}
