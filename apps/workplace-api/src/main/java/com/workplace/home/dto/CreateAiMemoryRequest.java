package com.workplace.home.dto;

import java.util.UUID;

/**
 * 메모리 생성(WP-55). source·sessionId 는 Internal 대행(ai-agent remember_memory)일 때만 의미가 있다 — 일반 요청은 무시하고
 * USER 로 저장한다. 검증(종류·길이·범위·기한)은 서비스가 한다(@Size 는 UTF-16 단위라 이모지를 두 글자로 센다).
 *
 * <p>WP-379: scope(선택, null = 공통). WP-380: expiresOn(선택, yyyy-MM-dd — 오늘(Asia/Seoul) 이전이면 400).
 * 문자열로 받는 이유는 형식 오류를 Jackson 의 영문 400 대신 서비스의 한국어 400 으로 알리기 위해서다.
 */
public record CreateAiMemoryRequest(
    String kind, String content, String source, UUID sessionId, String scope, String expiresOn) {}
