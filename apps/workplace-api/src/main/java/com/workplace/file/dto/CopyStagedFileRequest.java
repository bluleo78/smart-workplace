package com.workplace.file.dto;

import com.workplace.file.api.StagedCopySource;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 읽을 수 있는 첨부를 스테이징 파일로 복사하는 요청(WP-1705).
 *
 * @param source 출처 도메인 키(issue·issue_chat·drive)
 * @param issueKey 이슈 키 — issue·issue_chat 에서 필요
 * @param messageId 이슈 챗 메시지 id — issue_chat 에서 필요
 * @param attachmentId 첨부 id — issue·issue_chat 에서 필요
 * @param driveFileId 드라이브 파일 id — drive 에서 필요
 * @param name 복사본 이름(생략하면 원본 이름)
 */
public record CopyStagedFileRequest(
    @NotBlank String source,
    @Size(max = 64) String issueKey,
    Long messageId,
    Long attachmentId,
    Long driveFileId,
    @Size(max = 255) String name) {

  /** 출처 리졸버에 넘길 값 묶음으로 바꾼다(name 은 복사본 이름이라 출처 식별에 쓰지 않는다). */
  public StagedCopySource toSource() {
    return new StagedCopySource(source, issueKey, messageId, attachmentId, driveFileId);
  }
}
