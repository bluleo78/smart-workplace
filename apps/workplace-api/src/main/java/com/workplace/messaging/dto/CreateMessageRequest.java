package com.workplace.messaging.dto;

import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 메시지 작성 요청. body 는 최대 4000 자(빈 본문 허용 — 첨부만 있는 메시지 가능). parentMessageId 있으면 스레드 답글(없으면 채널 최상위).
 * fileIds 는 선업로드된 첨부 파일 ID 목록.
 */
public record CreateMessageRequest(
    @Size(max = 4000) String body, Long parentMessageId, List<Long> fileIds) {

  /** 스레드가 아닌 일반 메시지용 보조 생성자 — parentMessageId = null, 첨부 없음. */
  public CreateMessageRequest(String body) {
    this(body, null, List.of());
  }

  /** 스레드 답글용 보조 생성자 — 첨부 없음. */
  public CreateMessageRequest(String body, Long parentMessageId) {
    this(body, parentMessageId, List.of());
  }

  /** null 방어: fileIds 가 null 이면 빈 리스트. */
  public List<Long> fileIds() {
    return fileIds == null ? List.of() : fileIds;
  }
}
