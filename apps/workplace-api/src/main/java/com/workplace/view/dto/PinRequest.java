package com.workplace.view.dto;

import jakarta.validation.constraints.NotNull;

/** 저장된 뷰 고정/해제 요청. */
public record PinRequest(@NotNull Boolean pinned) {}
