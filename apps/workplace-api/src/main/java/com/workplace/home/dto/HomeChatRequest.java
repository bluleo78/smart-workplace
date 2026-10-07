package com.workplace.home.dto;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

/**
 * 홈 채팅 요청 본문. sessionId null 이면 서비스가 새 세션 생성. screenContext 는 선택(WP-54 현재 화면).
 *
 * <p>WP-267: correlationId(선택)는 웹이 정한 생성 id — 요청 전에 알아야 응답보다 먼저 온 home.chat.* 이벤트를 바로 대화에 붙인다. UUID
 * 형식이 아니면 역직렬화가 400 으로 거절하고, 없으면 서버가 발급한다.
 *
 * <p>WP-234: fileIds(선택)는 선업로드한 첨부 id. query 는 첨부가 있으면 비어도 된다 — "본문도 첨부도 없음"만 400. 검사는 Bean
 * Validation 대신 컨트롤러·서비스가 한국어 문구로 한다(검증 실패 기본 문구가 영문이라).
 */
public record HomeChatRequest(
    UUID sessionId,
    String query,
    @Valid AiScreenContext screenContext,
    List<Long> fileIds,
    UUID correlationId) {

  /** 보낼 내용이 있는지 — 공백 아닌 본문 또는 첨부 1개 이상. */
  public boolean hasContent() {
    return (query != null && !query.isBlank()) || (fileIds != null && !fileIds.isEmpty());
  }

  /** null 이면 빈 목록. */
  public List<Long> fileIdsOrEmpty() {
    return fileIds == null ? List.of() : fileIds;
  }
}
