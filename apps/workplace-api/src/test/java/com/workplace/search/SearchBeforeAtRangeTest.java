package com.workplace.search;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.time.SupportedDates;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1584: 통합 검색(메시지·메일) 커서 시각 beforeAt 의 지원 범위(1900-01-01 ~ 9999-12-31) 검증.
 *
 * <p>예전엔 {@code +999999999-12-31T00:00:00Z} 같은 값이 DB 까지 가서 409 「저장할 수 없는 값」이 났고, 1899년 값은 조용히 200
 * 이었다. 이제 컨트롤러 검증({@code SupportedDateTime})에서 한국어 400({@link SupportedDates#MESSAGE})으로 거절하고, 범위 양
 * 끝 값·형식 오류는 예전 그대로인지 확인한다. 같은 커서(MailListCursor)를 쓰는 메일함 목록 beforeAt 도 함께 본다.
 */
@Transactional
class SearchBeforeAtRangeTest extends IntegrationTestBase {

  private static final String MESSAGES = "/api/v1/search/messages";
  private static final String MAIL = "/api/v1/search/mail";

  /** 같은 MailListCursor 를 쓰는 메일함 목록 — 없는 계정 id 라 검증을 지나면 404 가 된다. */
  private static final String MAILBOX = "/api/v1/mail/accounts/999999999/messages";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;

  private long me;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    me = withMembership(TestFixtures.createHuman(dsl));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 검색어(2자 이상 — 짧으면 빈 결과로 바로 끝나 DB 까지 가지 않는다)와 커서를 붙여 내 토큰으로 부른다. 요청 뒤 테넌트를 되돌려 놓는다. */
  private ResultActions search(String path, String beforeAt) throws Exception {
    ResultActions r =
        mvc.perform(
            get(path)
                .param("q", "zqrange")
                .param("beforeAt", beforeAt)
                .param("beforeId", "1")
                .header("Authorization", "Bearer " + jwt.generateAccessToken(me, "u-" + me, 1L)));
    TenantContext.set(1L);
    return r;
  }

  /**
   * 검색 두 곳: 범위 밖(상한 밖 극단 연도·하한 밖 1899년)은 400 + 범위 안내. 예전엔 극단 연도는 DB 에서 409 「저장할 수 없는 값」, 1899년은 조용히
   * 200 이었다.
   */
  @ParameterizedTest
  @CsvSource({
    MESSAGES + ", +999999999-12-31T00:00:00Z",
    MESSAGES + ", 1899-12-31T23:59:59Z",
    MAIL + ", +999999999-12-31T00:00:00Z",
    MAIL + ", 1899-12-31T23:59:59Z"
  })
  void search_outOfRangeBeforeAt_400(String path, String beforeAt) throws Exception {
    search(path, beforeAt)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.beforeAt").value(SupportedDates.MESSAGE));
  }

  /** 검색 두 곳: 범위 양 끝(포함)은 검증을 통과해 200 — 경계가 한 칸 밀리지 않았고 정상 쪽 넘김은 그대로다. */
  @ParameterizedTest
  @CsvSource({
    MESSAGES + ", 1900-01-01T00:00:00Z",
    MESSAGES + ", 9999-12-31T23:59:59Z",
    MAIL + ", 1900-01-01T00:00:00Z",
    MAIL + ", 9999-12-31T23:59:59Z"
  })
  void search_boundaryBeforeAt_200(String path, String beforeAt) throws Exception {
    search(path, beforeAt).andExpect(status().isOk());
  }

  /** 형식 오류는 예전 그대로 형식 안내의 400(범위 문구가 아니다). */
  @Test
  void messages_malformedBeforeAt_400WithFormatMessage() throws Exception {
    search(MESSAGES, "nope")
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.errors.beforeAt").value("날짜·시간 형식(예: 2026-01-31T00:00:00Z)이어야 합니다."));
  }

  /** 메일함 목록: 극단 연도 beforeAt 도 400 + 범위 안내(예전엔 409). */
  @Test
  void mailbox_extremeBeforeAt_400() throws Exception {
    search(MAILBOX, "+999999999-12-31T00:00:00Z")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.beforeAt").value(SupportedDates.MESSAGE));
  }

  /** 메일함 목록: 범위 안 값은 검증을 통과한다 — 없는 계정이라 404(400 이 아님). */
  @Test
  void mailbox_maxBeforeAt_passesValidation() throws Exception {
    search(MAILBOX, "9999-12-31T23:59:59Z").andExpect(status().isNotFound());
  }
}
