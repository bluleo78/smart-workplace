package com.workplace.issue.dto;

/** 자식 SUBTASK 응답에 포함되는 부모 이슈 요약 (번호/제목/유형). */
public record ParentRef(int number, String title, IssueTypeSummary type) {}
