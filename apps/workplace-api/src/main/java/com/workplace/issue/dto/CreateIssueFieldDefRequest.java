package com.workplace.issue.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * POST / PATCH 본문. PATCH 에서는 type 을 동일 값으로 전송 (변경 시 400). options 는 SELECT/MULTI_SELECT 만 non-null.
 */
public record CreateIssueFieldDefRequest(
    @NotBlank @Size(max = 40) String name, @NotBlank String type, JsonNode options) {}
