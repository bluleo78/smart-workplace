package com.workplace.issue.outbound.dto;

import java.util.List;

/** ai-agent POST /issue/classify 응답 DTO. type 은 개인 프로젝트일 때 null 가능. */
public record IssueClassifyResult(
    String type, String priority, List<String> labels, String reason) {}
