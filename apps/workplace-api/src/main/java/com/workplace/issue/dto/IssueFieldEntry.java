package com.workplace.issue.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** 이슈 응답에 임베드되는 필드 값 한 건. value 는 type 에 따라 모양이 다른 JsonNode. */
public record IssueFieldEntry(Long defId, String name, String type, JsonNode value) {}
