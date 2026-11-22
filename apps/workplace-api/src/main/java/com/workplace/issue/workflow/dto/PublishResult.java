package com.workplace.issue.workflow.dto;

/**
 * 게시 응답.
 *
 * @param runningRunsOnOlderVersions 옛 버전으로 돌고 있는 실행 수(실행 표가 생기기 전까지 0)
 */
public record PublishResult(int versionNo, int runningRunsOnOlderVersions) {}
