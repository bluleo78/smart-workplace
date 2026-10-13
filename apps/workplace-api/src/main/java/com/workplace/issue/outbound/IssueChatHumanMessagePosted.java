package com.workplace.issue.outbound;

/** 사람이 이슈 챗에 글을 올렸다는 이벤트(WP-377) — 답변 필요로 멈춘 AI 구성원 작업을 작업 중으로 되돌리는 신호. */
public record IssueChatHumanMessagePosted(long issueId) {}
