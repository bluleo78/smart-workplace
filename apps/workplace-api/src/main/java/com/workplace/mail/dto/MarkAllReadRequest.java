package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * WP-187 모두 읽음 요청 — 지금 보기(분류·회신필요·검색어)와, 확인 다이얼로그를 연 시점의 서버(DB) 시각 asOf. category 가 비면 전체(받은편지함).
 * asOf 이후 도착한 메일은 대상에서 빠진다.
 */
public record MarkAllReadRequest(
    String category, boolean needsReply, String query, OffsetDateTime asOf) {}
