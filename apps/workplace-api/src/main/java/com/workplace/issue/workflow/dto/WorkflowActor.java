package com.workplace.issue.workflow.dto;

/** 게시한 사람의 요약(사용자 행이 없으면 담는 쪽 칸이 null). */
public record WorkflowActor(long id, String username, String name) {}
