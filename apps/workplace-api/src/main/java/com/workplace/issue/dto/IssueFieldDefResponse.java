package com.workplace.issue.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

/** 필드 정의 응답 DTO. options 는 null 또는 string 배열 JsonNode. */
public record IssueFieldDefResponse(
    Long id,
    Long projectId,
    String name,
    String type,
    JsonNode options,
    int position,
    Instant createdAt,
    Instant updatedAt) {}
