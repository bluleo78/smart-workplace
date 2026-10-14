package com.workplace.home.dto;

import java.util.UUID;

/**
 * 메모리 생성(WP-55). source·sessionId 는 Internal 대행(ai-agent remember_memory)일 때만 의미가 있다 — 일반 요청은 무시하고
 * USER 로 저장한다. 검증(종류·길이·범위)은 서비스가 코드포인트 기준으로 한다(@Size 는 UTF-16 단위라 이모지를 두 글자로 센다).
 *
 * <p>WP-379: scope(선택, null = 공통) — ISSUE·WIKI·MAIL·DRIVE·MESSAGING·CALENDAR 밖이면 400.
 */
public record CreateAiMemoryRequest(
    String kind, String content, String source, UUID sessionId, String scope) {

  /** 공통으로 만드는 호출(기존 호출부·테스트 호환). */
  public CreateAiMemoryRequest(String kind, String content, String source, UUID sessionId) {
    this(kind, content, source, sessionId, null);
  }
}
