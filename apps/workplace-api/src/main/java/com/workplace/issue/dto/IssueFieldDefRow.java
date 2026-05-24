package com.workplace.issue.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;

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
