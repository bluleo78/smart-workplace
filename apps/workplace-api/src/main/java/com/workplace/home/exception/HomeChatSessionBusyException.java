package com.workplace.home.exception;

/** WP-190: 같은 대화에서 이미 답변을 생성 중 — 대화당 생성은 1개(409 CHAT_SESSION_BUSY). */
public class HomeChatSessionBusyException extends RuntimeException {
  public static final String CODE = "CHAT_SESSION_BUSY";

  public HomeChatSessionBusyException() {
    super("이 대화는 아직 답변 중이에요");
  }
}
