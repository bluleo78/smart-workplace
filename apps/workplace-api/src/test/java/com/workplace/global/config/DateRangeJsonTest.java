package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.milestone.dto.CreateMilestoneRequest;
import com.workplace.support.IntegrationTestBase;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-725 — 앱 ObjectMapper 는 모든 요청 본문의 날짜(LocalDate)를 1900-01-01 ~ 9999-12-31 로 제한한다. 마일스톤·사이클처럼 DTO
 * 마다 검사를 두지 않아도 같은 규칙이 걸리는지 본다.
 */
class DateRangeJsonTest extends IntegrationTestBase {

  @Autowired ObjectMapper objectMapper;

  @Test
  void 마일스톤_사이클_날짜도_범위_밖이면_거절한다() {
    assertThatThrownBy(
            () ->
                objectMapper.readValue(
                    "{\"name\":\"m\",\"dueDate\":\"+20000-01-01\"}", CreateMilestoneRequest.class))
        .hasRootCauseMessage("날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다");
    assertThatThrownBy(
            () ->
                objectMapper.readValue(
                    "{\"name\":\"c\",\"startDate\":\"2026-01-01\",\"endDate\":\"+999999999-12-31\"}",
                    CreateCycleRequest.class))
        .hasRootCauseMessage("날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다");
  }

  @Test
  void 범위_안의_날짜는_그대로_읽는다() throws Exception {
    var req =
        objectMapper.readValue(
            "{\"name\":\"m\",\"dueDate\":\"9999-12-31\"}", CreateMilestoneRequest.class);
    assertThat(req.dueDate()).isEqualTo(LocalDate.of(9999, 12, 31));
  }
}
