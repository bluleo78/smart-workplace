package com.workplace.drive.dto;

import jakarta.validation.constraints.NotNull;

public record AddMemberRequest(@NotNull Long userId, @NotNull String role) {}
