package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.time.LocalDate;

/**
 * AI 메모리 1건(WP-55). previousContent·previousKind 는 고치기 응답에만(그 외 null → JSON 에서 빠짐) — ai-agent
 * update_memory 결과와 채팅 되돌리기 근거가 된다(previousKind 가 있어야 AI 가 종류까지 바꾼 고침을 종류째 되돌린다).
 *
 * <p>WP-379: scope 는 항상 싣는다(null = 공통). previousScope 는 고치기 응답에서 이전 범위가 앱일 때만 실린다.
 *
 * <p>WP-380: expiresOn 은 항상(null = 기한 없음, yyyy-MM-dd), expired 는 서버 오늘(Asia/Seoul) 기준 만료 여부 — 웹은
 * 날짜를 다시 계산하지 않고 이 값을 쓴다(오늘 판정을 서버 시계 하나로 맞춘다). previousExpiresOn 은 고치기 응답에서 이전 기한이 있었을 때만(없으면 빠짐 =
 * 기한 없음).
 *
 * <p>WP-383: pinned — 사용자가 설정에서 고정했는가(고정 행은 설정 묶음 맨 위·채팅 주입에 먼저 실린다 — 토큰 예산 안에서).
 */
public record AiMemoryItem(
    long id,
    String kind,
    String content,
    String source,
    Instant createdAt,
    Instant updatedAt,
    @JsonInclude(JsonInclude.Include.NON_NULL) String previousContent,
    @JsonInclude(JsonInclude.Include.NON_NULL) String previousKind,
    String scope,
    @JsonInclude(JsonInclude.Include.NON_NULL) String previousScope,
    LocalDate expiresOn,
    boolean expired,
    @JsonInclude(JsonInclude.Include.NON_NULL) LocalDate previousExpiresOn,
    boolean pinned) {}
