package com.workplace.global.time;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.ReportAgentWorkRequest;
import com.workplace.messaging.dto.ConfirmProposalRequest;
import com.workplace.messaging.dto.CreateProposalRequest;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.wiki.dto.WikiPageShareRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.util.Set;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 요청의 시각(Instant·OffsetDateTime)도 날짜와 같은 1900~9999년 범위만 받는다(WP-744).
 *
 * <p>날짜(LocalDate)는 WP-725 에서 막았지만 시각 필드 — 일정 시작·종료, API 토큰·노트·드라이브 공유 만료, 일정 제안, 에이전트 다음 실행 — 는
 * 0년이나 {@code +99999-01-01T00:00:00Z} 같은 확장 연도가 그대로 저장돼 다른 클라이언트가 해석하지 못하는 값으로 돌아왔다. 형식이 틀린 날짜의 400
 * 은 어느 칸인지 알려 준다.
 */
@Transactional
class SupportedDateTimeRangeTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ObjectMapper om;
  @Autowired Validator validator;

  private String token;

  @BeforeEach
  void user() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, id, "USER");
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    token = jwtTokenProvider.generateAccessToken(id, "dt-" + id, 1L);
  }

  @Test
  void 일정_시각이_범위_밖이면_400() throws Exception {
    mvc.perform(
            post("/api/v1/calendar/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"title\":\"t\",\"startsAt\":\"0000-01-01T00:00:00Z\",\"endsAt\":\"+10000-01-02T00:00:00Z\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.startsAt").value(SupportedDates.MESSAGE))
        .andExpect(jsonPath("$.errors.endsAt").value(SupportedDates.MESSAGE));
  }

  @Test
  void API_토큰_만료가_범위_밖이면_400() throws Exception {
    mvc.perform(
            post("/api/v1/users/me/api-tokens")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"t\",\"expiresAt\":\"+99999-01-01T00:00:00Z\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.expiresAt").value(SupportedDates.MESSAGE));
  }

  @Test
  void 공유_만료_제안_에이전트_실행_시각도_범위를_검사한다() throws Exception {
    assertThat(
            violations("{\"expiresAt\":\"+100000-01-01T00:00:00Z\"}", CreateShareLinkRequest.class))
        .containsExactly("expiresAt");
    assertThat(
            violations(
                "{\"audience\":\"PUBLIC\",\"permission\":\"VIEW\",\"expiresAt\":\"+99999-01-01T00:00:00Z\"}",
                WikiPageShareRequest.class))
        .contains("expiresAt");
    assertThat(
            violations(
                "{\"startsAt\":\"0000-01-01T00:00:00Z\",\"endsAt\":\"9999-12-31T23:59:59Z\"}",
                ConfirmProposalRequest.class))
        .containsExactly("startsAt");
    assertThat(
            violations(
                "{\"startsAt\":\"1899-12-31T23:59:59Z\",\"endsAt\":\"+10000-01-01T00:00:00Z\"}",
                CreateProposalRequest.class))
        .contains("startsAt", "endsAt");
    assertThat(
            violations(
                "{\"state\":\"SCHEDULED\",\"note\":\"n\",\"nextRunAt\":\"+10000-01-01T00:00:00Z\"}",
                ReportAgentWorkRequest.class))
        .contains("nextRunAt");
  }

  @Test
  void 형식이_틀린_날짜는_어느_칸인지_알려_준다() throws Exception {
    mvc.perform(
            post("/api/v1/calendar/events")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"title\":\"t\",\"startsAt\":\"2026-02-30T00:00:00Z\",\"endsAt\":\"2026-03-01T00:00:00Z\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("요청 본문을 해석할 수 없습니다."))
        .andExpect(jsonPath("$.errors.startsAt").value("형식이 올바르지 않습니다"));
  }

  /** JSON 을 DTO 로 읽어 검증하고, 범위 문구로 걸린 칸 이름만 돌려준다. */
  private <T> Set<String> violations(String json, Class<T> type) throws Exception {
    T dto = om.readValue(json, type);
    return validator.validate(dto).stream()
        .filter(v -> SupportedDates.MESSAGE.equals(v.getMessage()))
        .map(ConstraintViolation::getPropertyPath)
        .map(Object::toString)
        .collect(Collectors.toSet());
  }
}
