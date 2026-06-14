package com.workplace.wiki.exception;

public class WikiForbiddenException extends RuntimeException {
  public WikiForbiddenException(long spaceId, long userId) {
    super("위키 공간 권한 없음: space=" + spaceId + " user=" + userId);
  }
}
