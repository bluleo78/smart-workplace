package com.workplace.home.dto;

/** 고정 켜기·끄기(WP-383) — pinned 가 없으면 400(AI_MEMORY_INVALID). */
public record PinAiMemoryRequest(Boolean pinned) {}
