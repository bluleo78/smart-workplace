package com.workplace.auth.dto;

import jakarta.validation.constraints.Pattern;

/** null = 디폴트로 되돌림. */
public record UpdateAssistantSettingsRequest(
    String model, @Pattern(regexp = "NONE|NORMAL|DEEP") String thinkingDepth) {}
