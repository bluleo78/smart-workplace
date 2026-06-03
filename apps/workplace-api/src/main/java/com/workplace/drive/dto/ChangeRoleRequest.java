package com.workplace.drive.dto;

import jakarta.validation.constraints.NotNull;

public record ChangeRoleRequest(@NotNull String role) {}
