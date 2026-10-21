package com.workplace.wiki.exception;

/**
 * 관리자가 외부 공유를 꺼 둔 워크스페이스에서 노트 공유를 외부 공개(PUBLIC)로 만들거나 바꾸려 할 때(409, WP-579). 요청이 잘못된 것이 아니라 지금 정책과
 * 부딪힌 것이므로 400 이 아니라 409 로 돌려, 공유 창이 「관리자가 외부 공유를 허용하지 않았습니다」로 안내하게 한다.
 */
public class WikiExternalShareDisabledException extends RuntimeException {
  public WikiExternalShareDisabledException() {
    super("관리자가 외부 공유를 허용하지 않았습니다");
  }
}
