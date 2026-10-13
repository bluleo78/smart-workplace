package com.workplace.home.dto;

/** 메모리 고치기(WP-55) — 생략한 필드는 그대로 둔다. 둘 다 없으면 400. */
public record UpdateAiMemoryRequest(String content, String kind) {}
