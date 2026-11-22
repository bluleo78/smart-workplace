package com.workplace.issue.workflow.dto;

import java.time.Instant;

/** 지금 쓰는 게시 버전의 요약({@link WorkflowDetail} 안). */
public record WorkflowActiveVersion(int no, Instant createdAt, WorkflowActor createdBy) {}
