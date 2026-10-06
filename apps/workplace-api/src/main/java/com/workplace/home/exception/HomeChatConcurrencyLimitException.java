package com.workplace.home.exception;

/** WP-190: 사용자 동시 생성 상한 초과 — 대기열 없이 거절(429 CHAT_CONCURRENCY_LIMIT). */
public class HomeChatConcurrencyLimitException extends RuntimeException {
  public static final String CODE = "CHAT_CONCURRENCY_LIMIT";

  public HomeChatConcurrencyLimitException(int limit) {
    super("다른 대화 " + limit + "개가 답변 중이에요. 하나가 끝나면 보낼 수 있어요.");
  }
}
