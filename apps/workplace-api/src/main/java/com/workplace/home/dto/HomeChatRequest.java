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
 *
 * <p>WP-379: app(선택)은 지금 화면 앱(ISSUE·WIKI·MAIL·DRIVE·MESSAGING·CALENDAR) — 공통 + 그 앱 메모리를 고르는 데만 쓴다.
 * 화면 참고 칩을 꺼도 웹이 보낸다(화면 내용이 아니라 내 선호 선택용). 모르는 값은 서비스가 400 대신 "앱 없음"으로 다룬다 — 구·신 웹이 엇갈려도 메모리 부가 기능
 * 때문에 채팅을 막지 않는다.
 *
 * <p>WP-386: space(선택)는 화면 맥락의 공간 — PROJECT 는 key, WIKI_SPACE 는 id. 서버가 다시 확인해 맞을 때만 쓴다.
 */
public record HomeChatRequest(
    UUID sessionId,
    String query,
    @Valid AiScreenContext screenContext,
    List<Long> fileIds,
    UUID correlationId,
    String app,
    @Valid Space space) {

  /** WP-386 화면 공간(클라이언트 값 — 서버가 SharedMemorySpaces.verifyForMessage 로 다시 확인한다). */
  public record Space(
      @jakarta.validation.constraints.Size(max = 16) String type,
      @jakarta.validation.constraints.Size(max = 10) String key,
      Long id) {}

  /**
   * 본문 상한(WP-674) — 상한이 없어 아주 긴 글도 그대로 저장되고 AI 에 넘어갔다. 긴 자료는 첨부로 보내게 하고, 붙여 넣은 메일·문서 한두 쪽은 들어갈 만큼
   * 이슈 본문과 같은 10000자. 웹 입력창·ai-agent 검증과 같은 값.
   */
  public static final int QUERY_MAX = 10_000;

  /** 본문 상한을 넘었을 때 안내 — 다른 검사처럼 컨트롤러가 한국어 문구로 400 을 낸다. */
  public static final String MSG_QUERY_TOO_LONG = "AI 에게 보내는 글은 10000자 이하로 입력해 주세요.";

  /** 본문이 상한을 넘는지 — 웹·ai-agent 와 같이 앞뒤 공백을 뺀 길이로 잰다. */
  public boolean queryTooLong() {
    return query != null && query.strip().length() > QUERY_MAX;
  }

  /** 보낼 내용이 있는지 — 공백 아닌 본문 또는 첨부 1개 이상. */
  public boolean hasContent() {
    return (query != null && !query.isBlank()) || (fileIds != null && !fileIds.isEmpty());
  }

  /** null 이면 빈 목록. */
  public List<Long> fileIdsOrEmpty() {
    return fileIds == null ? List.of() : fileIds;
  }
}
