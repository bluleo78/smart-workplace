package com.workplace.home.dto;

import java.time.Instant;
import java.util.UUID;

/** 세션 목록 1건(스위처용). */
public record HomeSessionSummary(UUID id, String title, Instant lastMessageAt, int widgetCount) {}
