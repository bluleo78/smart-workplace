package com.workplace.issue.dto;

/** 결정적 블로커 신호 1개. message 는 프론트 배지 텍스트. */
public record IssueBlockerBadge(BlockerType type, String message) {
  public enum BlockerType {
    BLOCKED,
    OVERDUE,
    STALE
  }
}
