package com.workplace.messaging.dto;

/** 임대 획득 결과(WP-1979). status 는 ACQUIRED·QUEUED·DUPLICATE, token 은 ACQUIRED 일 때만 채운다. */
public record MessagingAgentRunAcquireResponse(String status, String token) {

  public static final String ACQUIRED = "ACQUIRED";
  public static final String QUEUED = "QUEUED";
  public static final String DUPLICATE = "DUPLICATE";
}
