package com.workplace.global.exception;

/**
 * 스트리밍 생성 예약 거절(WP-190) — 같은 대상이 이미 생성 중(BUSY)이거나 소유자의 동시 생성 상한(LIMIT)에 닿았다. 레지스트리는 도메인 응답을 모르므로,
 * 도메인 서비스가 자기 오류(예: 홈 채팅 409/429)로 바꿔 던진다.
 */
public class StreamingGenerationRejectedException extends RuntimeException {

  /** 거절 사유. */
  public enum Reason {
    BUSY,
    LIMIT
  }

  private final Reason reason;

  public StreamingGenerationRejectedException(Reason reason) {
    super("streaming generation rejected: " + reason);
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}
