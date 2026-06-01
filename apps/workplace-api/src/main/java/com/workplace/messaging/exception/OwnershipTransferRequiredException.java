package com.workplace.messaging.exception;

/** OWNER 가 소유권을 넘기지 않고 나가려 함. → 409. */
public class OwnershipTransferRequiredException extends RuntimeException {
  public OwnershipTransferRequiredException(long channelId) {
    super("owner must transfer ownership before leaving channel " + channelId);
  }
}
