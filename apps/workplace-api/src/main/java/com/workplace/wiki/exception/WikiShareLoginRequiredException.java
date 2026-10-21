package com.workplace.wiki.exception;

/**
 * 외부 보기({@code GET /api/v1/public/wiki/shares/{token}})로 만료 전 내부(WORKSPACE·PEOPLE) 공유 링크를 열었다(401,
 * WP-579). 웹은 로그인 화면으로 보내고, 로그인 뒤 이 링크로 돌아온다. 없음·만료·외부 공유 꺼짐은 이 예외가 아니라 404 다.
 */
public class WikiShareLoginRequiredException extends RuntimeException {
  public WikiShareLoginRequiredException() {
    super("로그인하면 열 수 있는 링크입니다");
  }
}
