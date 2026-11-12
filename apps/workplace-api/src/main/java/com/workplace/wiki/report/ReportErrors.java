package com.workplace.wiki.report;

/**
 * 리포트 실패 글 다루기(WP-1486) — 프로젝트 리포트·개인 보고의 생성기와 저장소가 함께 쓰는 실패 예외·오류 문구·저장 길이 규칙을 한 곳에 둔다. 두 쪽이 같은
 * 규칙(예외 문구가 없으면 예외 이름, DB 에는 앞 500자)으로 실패를 남기게 하려는 것이다.
 */
final class ReportErrors {

  /** 오류 글 저장 상한(자) — 회차·설정 테이블의 오류 칸에 이만큼만 남긴다. */
  static final int ERROR_MAX = 500;

  private ReportErrors() {}

  /** 「실패」로 처리할 생성 단계의 문제(상한 초과·빈 글·자리 없음) — 문구가 그대로 회차·설정의 오류로 남는다. */
  static final class ReportFailure extends RuntimeException {
    ReportFailure(String message) {
      super(message);
    }
  }

  /** 실패 예외의 문구 — 문구가 없으면 예외 이름이라도 남긴다(빈 오류로 기록되지 않게). */
  static String message(RuntimeException e) {
    return e.getMessage() == null ? e.toString() : e.getMessage();
  }

  /** 오류 글 앞 {@link #ERROR_MAX} 자(null 은 null). */
  static String trim(String error) {
    if (error == null) return null;
    return error.length() > ERROR_MAX ? error.substring(0, ERROR_MAX) : error;
  }
}
