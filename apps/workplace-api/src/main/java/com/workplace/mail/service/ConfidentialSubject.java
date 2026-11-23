package com.workplace.mail.service;

/**
 * 기밀 메일 제목 머리말(WP-2029). 기밀로 보내는 메일의 제목 앞에 「[기밀]」을 붙여, 받는 쪽이 어떤 메일 앱이든 한눈에 알아보게 한다. 발송 MIME 과 보낸
 * 사본이 같은 제목을 갖도록 이 한 곳에서 규칙을 정한다.
 */
public final class ConfidentialSubject {

  /** 제목 머리말 문구. */
  public static final String PREFIX = "[기밀]";

  private ConfidentialSubject() {}

  /** 제목에 머리말을 붙인다. 이미 「[기밀]」이 어디에든 들어 있으면(답장 RE: 포함) 그대로 두어 두 번 붙지 않게 하고, 제목이 비었으면 머리말만 쓴다. */
  public static String apply(String subject) {
    if (subject == null || subject.isBlank()) {
      return PREFIX;
    }
    if (subject.contains(PREFIX)) {
      return subject;
    }
    return PREFIX + " " + subject;
  }
}
