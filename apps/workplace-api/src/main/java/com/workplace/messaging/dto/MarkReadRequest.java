package com.workplace.messaging.dto;

import jakarta.validation.constraints.Positive;

/** 읽음 표시 — uptoMessageId 까지 읽음. */
public record MarkReadRequest(@Positive long uptoMessageId) {}
