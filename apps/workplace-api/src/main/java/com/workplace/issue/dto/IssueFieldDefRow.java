package com.workplace.issue.dto;

import java.time.Instant;
import tools.jackson.databind.JsonNode;

/** 내부 필드 정의 row — Repository 가 jOOQ Record 를 매핑한다. options 는 nullable JsonNode. */
public record IssueFieldDefRow(
    Long id,
    Long projectId,
    String name,
    String type,
    JsonNode options,
    int position,
    Instant createdAt,
    Instant updatedAt) {}
