package com.workplace.messaging.dto;

import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 메시지 작성 요청. body 는 최대 4000 자(빈 본문 허용 — 첨부만 있는 메시지 가능). parentMessageId 있으면 스레드 답글(없으면 채널 최상위).
 * fileIds 는 선업로드된 첨부 파일 ID 목록. driveFileIds 는 드라이브 파일 교차링크 ID 목록.
 */
public record CreateMessageRequest(
    @Size(max = 4000) String body,
    Long parentMessageId,
    List<Long> fileIds,
    List<Long> driveFileIds) {

  /** 스레드가 아닌 일반 메시지용 보조 생성자 — parentMessageId = null, 첨부 없음, 드라이브 링크 없음. */
  public CreateMessageRequest(String body) {
    this(body, null, List.of(), List.of());
  }

  /** 스레드 답글용 보조 생성자 — 첨부 없음, 드라이브 링크 없음. */
  public CreateMessageRequest(String body, Long parentMessageId) {
    this(body, parentMessageId, List.of(), List.of());
  }

  /** 기존 3-인자 보조 생성자 — 드라이브 링크 없음(하위 호환). */
  public CreateMessageRequest(String body, Long parentMessageId, List<Long> fileIds) {
    this(body, parentMessageId, fileIds, List.of());
  }

  /** null 방어: fileIds 가 null 이면 빈 리스트. */
  public List<Long> fileIds() {
    return fileIds == null ? List.of() : fileIds;
  }

  /** null 방어: driveFileIds 가 null 이면 빈 리스트. */
  public List<Long> driveFileIds() {
    return driveFileIds == null ? List.of() : driveFileIds;
  }
}
