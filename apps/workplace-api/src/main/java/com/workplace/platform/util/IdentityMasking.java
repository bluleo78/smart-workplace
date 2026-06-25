package com.workplace.platform.util;

/**
 * 테넌트 구성원 신원 부분 마스킹 — 운영자가 개별 멤버를 식별할 수 없도록 가린다.
 *
 * <p>이메일/이메일형 식별자: 로컬파트·도메인 라벨의 첫 글자만 남기고 가린다(예: gildong@corp.com → g***@c***.com). 이름: 첫 글자만 남기고
 * 나머지를 가린다(예: 홍길동 → 홍**). null/빈 문자열은 그대로 반환한다.
 */
public final class IdentityMasking {

  private IdentityMasking() {}

  /** 이메일 또는 이메일형 로그인 ID 부분 마스킹. '@' 가 없으면 첫 글자 + "***" 로 degrade. */
  public static String maskEmailLike(String value) {
    if (value == null || value.isEmpty()) {
      return value;
    }
    int at = value.indexOf('@');
    if (at < 0) {
      return maskToken(value);
    }
    String local = value.substring(0, at);
    String domain = value.substring(at + 1);
    return maskToken(local) + "@" + maskDomain(domain);
  }

  /** 이름 부분 마스킹 — 첫 글자만 남기고 나머지는 '*'. 한 글자면 "*". */
  public static String maskName(String value) {
    if (value == null || value.isEmpty()) {
      return value;
    }
    if (value.length() == 1) {
      return "*";
    }
    return value.charAt(0) + "*".repeat(value.length() - 1);
  }

  /** 토큰(로컬파트 등) → 첫 글자 + "***". 빈 토큰은 "***". */
  private static String maskToken(String token) {
    if (token.isEmpty()) {
      return "***";
    }
    return token.charAt(0) + "***";
  }

  /** 도메인 → 첫 라벨 첫 글자 + "***" + 나머지(TLD 등). 예: corp.com → c***.com, b.io → b***.io. */
  private static String maskDomain(String domain) {
    int dot = domain.indexOf('.');
    if (dot < 0) {
      return maskToken(domain);
    }
    String first = domain.substring(0, dot);
    String rest = domain.substring(dot); // ".com" 등
    return maskToken(first) + rest;
  }
}
