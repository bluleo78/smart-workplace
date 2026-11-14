package com.workplace.calendar;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.time.SupportedDates;
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
 * WP-1579: 일정 API 쿼리 파라미터 시각(from·to·occurrenceDate)의 지원 범위(1900-01-01 ~ 9999-12-31) 검증.
 *
 * <p>예전엔 {@code +999999999-01-01T00:00:00Z} 같은 값이 DB 까지 가서 영어 409 가 났다. 이제 컨트롤러 검증({@code
 * SupportedDateTime})에서 한국어 400({@link SupportedDates#MESSAGE})으로 거절하고, 범위 안 값은 그대로 목록을 돌려주는지 확인한다.
 */
@Transactional
class CalendarEventListDateRangeTest extends IntegrationTestBase {

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

  /**
   * 목록 from·to 가 모두 극단 연도(순서는 맞음)면 400 + 범위 안내(예전엔 409). from&gt;to 검사에 걸리지 않게 둘 다 범위 밖에 둔다 — 이 범위
   * 검사가 없으면 DB 까지 가는 경우다.
   */
  @Test
  void list_extremeFrom_400() throws Exception {
    mvc.perform(
            get("/api/v1/calendar/events")
                .param("from", "+999999999-01-01T00:00:00Z")
                .param("to", "+999999999-01-02T00:00:00Z")
                .with(as(me)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.from").value(SupportedDates.MESSAGE));
  }

  /** 목록 기간이 하한 밖(1899년, 순서는 맞음)이어도 같은 400 — from&gt;to 검사가 아니라 범위 검사로 거절된다. */
  @Test
  void list_belowMinimumTo_400() throws Exception {
    mvc.perform(
            get("/api/v1/calendar/events")
                .param("from", "1899-12-01T00:00:00Z")
                .param("to", "1899-12-31T00:00:00Z")
                .with(as(me)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.to").value(SupportedDates.MESSAGE));
  }

  /** 범위 안의 보통 기간은 검증을 통과해 200 목록을 돌려준다 — @Validated 를 붙여도 정상 조회는 그대로다. */
  @Test
  void list_normalRange_200() throws Exception {
    mvc.perform(
            get("/api/v1/calendar/events")
                .param("from", "2026-11-01T00:00:00Z")
                .param("to", "2026-12-01T00:00:00Z")
                .with(as(me)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$").isArray());
  }

  /** 삭제의 occurrenceDate 도 같은 제약 — 극단 연도는 일정 조회 전에 400 으로 거절한다. */
  @Test
  void delete_extremeOccurrenceDate_400() throws Exception {
    mvc.perform(
            delete("/api/v1/calendar/events/1")
                .param("scope", "THIS")
                .param("occurrenceDate", "+999999999-01-01T00:00:00Z")
                .with(as(me)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.occurrenceDate").value(SupportedDates.MESSAGE));
  }

  /**
   * 수정의 occurrenceDate 도 같은 제약(WP-1585) — 반복 일정 회차를 고칠 때 극단 연도(앞·뒤 끝 모두)를 주면 회차 계산의
   * DateTimeException 500 대신 한국어 400 이다. 본문은 유효하게 줘서 occurrenceDate 검증만 걸리게 한다.
   */
  @Test
  void update_extremeOccurrenceDate_400() throws Exception {
    String body =
        "{\"title\":\"회의\",\"startsAt\":\"2026-11-20T01:00:00Z\",\"endsAt\":\"2026-11-20T02:00:00Z\"}";
    for (String extreme : List.of("+999999999-12-31T00:00:00Z", "-999999999-01-01T00:00:00Z")) {
      mvc.perform(
              patch("/api/v1/calendar/events/1")
                  .param("scope", "THIS")
                  .param("occurrenceDate", extreme)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(body)
                  .with(as(me)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.errors.occurrenceDate").value(SupportedDates.MESSAGE));
    }
  }
}
