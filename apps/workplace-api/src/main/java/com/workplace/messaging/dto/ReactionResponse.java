package com.workplace.messaging.dto;

/** 메시지의 이모지별 리액션 집계. reacted = 호출자가 누른 여부. */
public record ReactionResponse(String emoji, int count, boolean reacted) {}
