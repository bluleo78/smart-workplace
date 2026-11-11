package com.workplace.issue.profile;

/**
 * 「다시 분석」 응답(WP-1485) — 무엇을 했는지와 처리 뒤의 프로파일.
 *
 * @param outcome 새로 시작 / 입력이 그대로라 다시 하지 않음 / 이미 분석 중
 * @param profile 처리 뒤 저장 행 기준 프로파일
 */
public record WorkProfileAnalyzeResponse(Outcome outcome, WorkProfileResponse profile) {

  /** 「다시 분석」 처리 결과. */
  public enum Outcome {
    /** 분석을 새로 시작했다(워커가 곧 결과를 채운다). */
    STARTED,
    /** 끝낸 이슈가 그대로라 다시 분석하지 않았다. */
    UNCHANGED,
    /** 이미 분석 중이다. */
    ALREADY_RUNNING
  }
}
