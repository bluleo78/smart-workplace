package com.workplace.file.api;

/**
 * 스테이징 복사의 출처 지정(WP-1705) — 어느 도메인의 어느 첨부를 가져올지 가리키는 값 묶음.
 *
 * <p>{@code source} 로 리졸버를 고르고, 나머지 필드 중 그 리졸버가 필요로 하는 것만 쓴다(안 쓰는 필드는 무시).
 *
 * @param source 출처 도메인 키({@code issue}·{@code issue_chat}·{@code drive})
 * @param issueKey 이슈 키(예: WP-12) — issue·issue_chat
 * @param messageId 이슈 챗 메시지 id — issue_chat
 * @param attachmentId 첨부 id — issue·issue_chat
 * @param driveFileId 드라이브 파일 id — drive
 */
public record StagedCopySource(
    String source, String issueKey, Long messageId, Long attachmentId, Long driveFileId) {}
