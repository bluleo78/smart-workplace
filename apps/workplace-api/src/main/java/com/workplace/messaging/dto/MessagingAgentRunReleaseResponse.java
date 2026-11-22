package com.workplace.messaging.dto;

import tools.jackson.databind.JsonNode;

/** 임대 반납 결과(WP-1979). next 는 기다리던 이벤트(acquire 때 받은 event 그대로), 없으면 null. */
public record MessagingAgentRunReleaseResponse(JsonNode next) {}
