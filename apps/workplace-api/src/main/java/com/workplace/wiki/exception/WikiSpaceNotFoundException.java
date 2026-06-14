package com.workplace.wiki.exception;

public class WikiSpaceNotFoundException extends RuntimeException {
  public WikiSpaceNotFoundException(long spaceId) {
    super("위키 공간을 찾을 수 없습니다: " + spaceId);
  }
}
