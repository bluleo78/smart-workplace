package com.workplace.auth.dto;

import com.workplace.global.time.SupportedDateTime;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;

/** PAT 발급 요청. expiresAt null 이면 무기한. */
public record IssueUserTokenRequest(
    @NotBlank @Size(max = 80) String name, @SupportedDateTime Instant expiresAt) {}
