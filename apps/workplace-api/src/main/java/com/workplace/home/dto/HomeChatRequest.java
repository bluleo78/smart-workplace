package com.workplace.home.dto;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

/**
 * 홈 채팅 요청 본문. sessionId null 이면 서비스가 새 세션 생성. screenContext 는 선택(WP-54 현재 화면).
 *
 * <p>WP-234: fileIds(선택)는 선업로드한 첨부 id. query 는 첨부가 있으면 비어도 된다 — "본문도 첨부도 없음"만 400. 검사는 Bean
 * Validation 대신 컨트롤러·서비스가 한국어 문구로 한다(검증 실패 기본 문구가 영문이라).
 */
public record HomeChatRequest(
    UUID sessionId, String query, @Valid AiScreenContext screenContext, List<Long> fileIds) {

  /** 보낼 내용이 있는지 — 공백 아닌 본문 또는 첨부 1개 이상. */
  public boolean hasContent() {
    return (query != null && !query.isBlank()) || (fileIds != null && !fileIds.isEmpty());
  }

  /** null 이면 빈 목록. */
  public List<Long> fileIdsOrEmpty() {
    return fileIds == null ? List.of() : fileIds;
  }
}
