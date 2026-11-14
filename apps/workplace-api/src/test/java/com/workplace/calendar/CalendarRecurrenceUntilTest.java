package com.workplace.calendar;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1590: 일정 생성·수정(scope=ALL)의 반복 규칙 UNTIL 검사.
 *
 * <p>예전엔 범위 밖 UNTIL(20261301T000000Z 등)이 500, 읽히지 않는 UNTIL(nope)은 조용히 버려져 끝없이 반복되는 일정으로 저장됐다. 이제 둘
 * 다 한국어 400 이고, 올바른 UTC UNTIL 은 그대로 받는지 HTTP 로 확인한다.
 */
@Transactional
class CalendarRecurrenceUntilTest extends IntegrationTestBase {

  /** 잘못된 UNTIL 거절 문구 — RecurrenceExpander.validate 가 던지는 그대로 응답 message 에 실린다. */
  private static final String UNTIL_MESSAGE = "반복 종료일(UNTIL)은 20261231T145959Z 처럼 UTC 날짜·시각이어야 합니다";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  long me;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = TestFixtures.createHuman(dsl);
  }

  /** 일정 읽기·쓰기 권한을 가진 사람 요청으로 꾸민다(요청마다 테넌트를 되돌려 놓는다). */
  private RequestPostProcessor as(long uid) {
    RequestPostProcessor auth =
        authentication(
            new UsernamePasswordAuthenticationToken(
                uid,
                "n/a",
                List.of(
                    new SimpleGrantedAuthority("calendar:read"),
                    new SimpleGrantedAuthority("calendar:write"))));
    return req -> {
      TenantContext.set(1L);
      return auth.postProcessRequest(req);
    };
  }

  /** 주어진 반복 규칙을 단 일정 본문(2026-11-20 10~11시 KST). */
  private static String body(String rrule) {
    return "{\"title\":\"회의\",\"startsAt\":\"2026-11-20T01:00:00Z\","
        + "\"endsAt\":\"2026-11-20T02:00:00Z\",\"recurrenceRule\":\""
        + rrule
        + "\"}";
  }

  /** 범위 밖 UNTIL 로 생성하면 500 대신 400 + 한국어 안내. */
  @Test
  void create_outOfRangeUntil_400() throws Exception {
    mvc.perform(
            post("/api/v1/calendar/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("FREQ=DAILY;UNTIL=20261301T000000Z"))
                .with(as(me)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(UNTIL_MESSAGE));
  }

  /** 읽히지 않는 UNTIL 로 생성하면 조용히 버리고 끝없는 반복으로 저장하는 대신 400. */
  @Test
  void create_unreadableUntil_400() throws Exception {
    mvc.perform(
            post("/api/v1/calendar/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("FREQ=DAILY;UNTIL=nope"))
                .with(as(me)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(UNTIL_MESSAGE));
  }

  /** 올바른 UTC UNTIL 은 그대로 받아 201. */
  @Test
  void create_validUntil_201() throws Exception {
    mvc.perform(
            post("/api/v1/calendar/events")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body("FREQ=DAILY;UNTIL=20261231T145959Z"))
                .with(as(me)))
        .andExpect(status().isCreated());
  }

  /** 정상 반복 일정을 만든 뒤 시리즈 전체(scope=ALL) 수정에서 잘못된 UNTIL(범위 밖·읽히지 않음)을 주면 400. */
  @Test
  void updateAll_malformedUntil_400() throws Exception {
    String created =
        mvc.perform(
                post("/api/v1/calendar/events")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(body("FREQ=DAILY;COUNT=5"))
                    .with(as(me)))
            .andExpect(status().isCreated())
            .andReturn()
            .getResponse()
            .getContentAsString();
    long id = new ObjectMapper().readTree(created).path("id").asLong();

    for (String rrule : List.of("FREQ=DAILY;UNTIL=20261301T000000Z", "FREQ=DAILY;UNTIL=nope")) {
      mvc.perform(
              patch("/api/v1/calendar/events/" + id)
                  .param("scope", "ALL")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body(rrule))
                  .with(as(me)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value(UNTIL_MESSAGE));
    }
  }
}
