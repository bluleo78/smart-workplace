package com.workplace.mail.dto;

/** #520 메일에 연결된 이슈 키(없으면 null). 메일 배지 표시용. */
public record LinkedIssue(String issueKey) {}
