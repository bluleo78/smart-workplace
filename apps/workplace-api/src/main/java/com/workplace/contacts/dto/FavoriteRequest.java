package com.workplace.contacts.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

/** 즐겨찾기 추가/해제 요청. targetType=MEMBER(→user.id) | EXTERNAL(→contact_entry.id). */
public record FavoriteRequest(
    @NotNull @Pattern(regexp = "MEMBER|EXTERNAL") String targetType, @Positive long targetId) {}
