package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** compose 응답: 세션 id + AI 한 줄 설명 + 위젯 스펙(JSON 배열). */
public record HomeComposeResponse(UUID sessionId, String message, JsonNode widgets) {}
