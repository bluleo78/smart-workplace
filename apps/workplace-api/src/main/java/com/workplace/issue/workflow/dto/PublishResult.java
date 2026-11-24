package com.workplace.issue.workflow.dto;

/**
 * 게시 응답.
 *
 * @param runningRunsOnOlderVersions 새 버전이 아닌 버전으로 돌고 있는 활성(RUNNING·WAITING·SUSPENDED) 실행 수(삭제된 이슈의
 *     실행은 뺀다)
 */
public record PublishResult(int versionNo, int runningRunsOnOlderVersions) {}
