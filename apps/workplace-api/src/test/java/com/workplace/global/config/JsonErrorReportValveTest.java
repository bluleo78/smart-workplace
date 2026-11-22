package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.exception.InvalidParameterResponses;
import org.junit.jupiter.api.Test;

/** 컨테이너 단계 오류 본문의 상태별 한국어 문구(JsonErrorReportValve.messageFor) 단위 테스트. */
class JsonErrorReportValveTest {

  /**
   * 컨테이너 단계 413 은 앱이 매개변수 한도 초과로 내는 413 과 같은 문구다 — 두 곳이 갈라지지 않게(WP-1949 리뷰 후속). 문구는 리터럴로 고정해 바뀌면 이
   * 테스트가 실패한다.
   */
  @Test
  void 컨테이너_413_문구는_앱_413_문구와_같다() {
    assertThat(JsonErrorReportValve.messageFor(413))
        .isEqualTo("요청이 너무 큽니다. 보내는 내용을 줄여 다시 시도해 주세요.")
        .isEqualTo(InvalidParameterResponses.Cause.TOO_LARGE.message());
  }
}
