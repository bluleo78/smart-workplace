package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;

/** PATCH /status 요청 — DnD 전용. */
public record UpdateStatusRequest(@NotBlank String status) {}
