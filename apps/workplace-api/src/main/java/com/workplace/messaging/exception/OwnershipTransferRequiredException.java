package com.workplace.messaging.exception;

/** OWNER 가 소유권을 넘기지 않고 나가려 함. → 409. */
public class OwnershipTransferRequiredException extends RuntimeException {
  public OwnershipTransferRequiredException(long channelId) {
    super("채널 소유자는 소유권을 다른 멤버에게 넘긴 뒤에 나갈 수 있습니다 (channelId: " + channelId + ")");
  }
}
