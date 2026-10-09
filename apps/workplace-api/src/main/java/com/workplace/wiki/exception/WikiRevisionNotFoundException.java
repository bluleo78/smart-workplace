package com.workplace.wiki.exception;

/** 노트의 그 version 리비전이 없다(WP-297) → 404. */
public class WikiRevisionNotFoundException extends RuntimeException {
  public WikiRevisionNotFoundException(long pageId, int version) {
    super("노트의 해당 버전을 찾을 수 없습니다: page=" + pageId + " version=" + version);
  }
}
