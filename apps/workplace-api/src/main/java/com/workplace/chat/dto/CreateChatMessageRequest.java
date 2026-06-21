package com.workplace.chat.dto;

import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * 메시지 작성 요청. body 최대 4000 자. 첨부(fileIds)나 드라이브 링크(driveFileIds)가 있으면 body 는 비어도 된다 — 빈-본문 검증은 서비스에서
 * 수행(EmptyChatMessageException).
 */
public record CreateChatMessageRequest(
    @Size(max = 4000) String body, List<Long> fileIds, List<Long> driveFileIds) {

  /** 본문만 있는 편의 생성자 — 기존 테스트 및 단순 호출부 호환용. */
  public CreateChatMessageRequest(String body) {
    this(body, List.of(), List.of());
  }

  /** null 안전 접근자 — 미전달 시 빈 리스트. */
  public List<Long> fileIds() {
    return fileIds == null ? List.of() : fileIds;
  }

  public List<Long> driveFileIds() {
    return driveFileIds == null ? List.of() : driveFileIds;
  }
}
