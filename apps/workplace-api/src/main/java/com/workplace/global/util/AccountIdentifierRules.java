package com.workplace.global.util;

/**
 * 계정 아이디·이메일 입력 규칙(WP-780).
 *
 * <p>아이디·이메일은 영문·숫자·기호(ASCII 출력 문자 U+0021~U+007E)만 받는다. 제로폭 공백(U+200B)·점자 빈칸(U+2800) 같은 보이지 않는 글자나
 * 키릴 「к」처럼 라틴 글자와 똑같이 보이는 다른 문자 체계 글자가 끼면, 기존 구성원과 눈으로 구분되지 않는 계정이 만들어지거나 자기 이메일을 남의 것과 똑같아 보이게 바꿀
 * 수 있어서다. 국제화 이메일(한글 도메인 등)도 함께 막히지만 회사 계정 주소에는 드물어 받아들인다. 빈 값·null 은 이 규칙이 아닌 각 필드의 필수
 * 여부(@NotBlank)가 판정한다.
 */
public final class AccountIdentifierRules {

  /** ASCII 출력 문자만(빈 문자열 허용 — 필수 여부는 따로 검사). {@code @Pattern(regexp = ...)} 에 쓴다. */
  public static final String ASCII_ONLY = "^[\\x21-\\x7E]*$";

  /** {@link #ASCII_ONLY} 위반 메시지. */
  public static final String ASCII_ONLY_MESSAGE =
      "아이디·이메일은 영문·숫자·기호로만 쓸 수 있습니다(보이지 않는 글자나 다른 문자 체계의 글자는 쓸 수 없습니다)";

  /** 이메일만 받는 칸의 {@link #ASCII_ONLY} 위반 메시지 — 외부 연락처 이메일(WP-779)처럼 아이디가 없는 곳에서 쓴다. */
  public static final String EMAIL_ASCII_ONLY_MESSAGE =
      "이메일은 영문·숫자·기호로만 쓸 수 있습니다(보이지 않는 글자나 다른 문자 체계의 글자는 쓸 수 없습니다)";

  private AccountIdentifierRules() {}
}
