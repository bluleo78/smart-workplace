package com.workplace.wiki.dto;

import jakarta.validation.constraints.NotNull;

public record ChangeRoleRequest(@NotNull String role) {}
