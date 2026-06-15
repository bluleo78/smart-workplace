package com.workplace.issue.dto;

/**
 * 다른 모듈(wiki 등)에 노출하는 경량 이슈 참조 — 칩 라벨·라우트 메타용. 호출자가 멤버인 프로젝트의 활성 이슈만 가시. projectKey+number 로 이슈
 * 키(KEY-N)를 구성하고, title 은 칩 라벨로 쓴다.
 */
public record IssueRef(long id, String projectKey, int number, String title) {}
