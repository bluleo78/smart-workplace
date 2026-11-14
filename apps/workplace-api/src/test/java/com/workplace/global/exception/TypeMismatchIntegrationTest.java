package com.workplace.global.exception;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.net.URI;
import org.hamcrest.Matchers;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 경로·쿼리·JSON 본문 값의 형식이 틀렸을 때 400 안내 문구에 자바 타입 이름이 나오지 않는지 실제 엔드포인트로 확인한다(WP-1394).
 *
 * <p>예전엔 「'abc'는 long 타입이어야 합니다.」처럼 {@code long}·{@code int}·{@code LocalDateTime} 같은 내부 타입 이름과 입력
 * 값이 그대로 화면·AI 도구 결과에 보였다.
 */
@Transactional
class TypeMismatchIntegrationTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private String token;

  /** 테넌트#1 ACTIVE 멤버인 USER 로 요청한다. */
  @BeforeEach
  void setUp() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    token = jwtTokenProvider.generateAccessToken(id, "human-" + id, 1L);
  }

  @Test
  void long_경로변수에_문자를_넣으면_정수여야_합니다() throws Exception {
    // DriveFileController.summary — @PathVariable("id") long
    expectError(get("/api/v1/drive/files/abc/summary"), "id", "정수여야 합니다.");
  }

  @Test
  void int_이슈번호에_문자를_넣으면_정수여야_합니다() throws Exception {
    // IssueController.get — @PathVariable int number
    expectError(get("/api/v1/projects/X/issues/abc"), "number", "정수여야 합니다.");
  }

  @Test
  void 날짜시간_쿼리에_엉뚱한_값을_넣으면_날짜시간_형식을_안내한다() throws Exception {
    // CalendarEventController.list — @RequestParam OffsetDateTime from/to
    expectError(
        get("/api/v1/calendar/events?from=notadate&to=2026-11-07T00:00:00Z"),
        "from",
        "날짜·시간 형식(예: 2026-01-31T00:00:00Z)이어야 합니다.");
  }

  @Test
  void List_Long_쿼리에_문자를_넣으면_원소_타입대로_정수여야_합니다() throws Exception {
    // UserGroupController.countMembers — @RequestParam("ids") List<Long>. requiredType 은 List 지만
    // 원소(Long)로 안내한다.
    expectError(get("/api/v1/user-groups/member-counts?ids=1,abc"), "ids", "정수여야 합니다.");
  }

  @Test
  void 그룹_구성원_수_조회의_빈_id_항목은_500_대신_400으로_거절한다() throws Exception {
    // WP-1598 — ids=, 는 null 원소 둘로 바인딩되어 언박싱 NPE(500)가 났다.
    for (String ids : new String[] {",", ",999999", "999999,", "1,,2"}) {
      mvc.perform(
              get("/api/v1/user-groups/member-counts?ids=" + ids)
                  .header("Authorization", "Bearer " + token))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("그룹 id 가 올바르지 않습니다"));
    }
  }

  @Test
  void JSON_본문_정수_칸에_문자를_넣으면_정수여야_합니다() throws Exception {
    // CalendarEventRequest.reminderMinutes — Integer. Jackson InvalidFormatException 의 targetType
    // 으로 안내한다.
    expectError(
        post("/api/v1/calendar/events")
            .contentType(MediaType.APPLICATION_JSON)
            .content(
                "{\"title\":\"t\",\"startsAt\":\"2026-03-01T00:00:00Z\","
                    + "\"endsAt\":\"2026-03-01T01:00:00Z\",\"reminderMinutes\":\"abc\"}"),
        "reminderMinutes",
        "정수여야 합니다.");
  }

  @Test
  void 박스형_Long_경로변수에_공백을_넣으면_정수여야_합니다() throws Exception {
    // WP-1599: SavedViewController.delete — @PathVariable Long id(users/{id} 는 user:read 로 USER 가
    // 403 이라 이 경로를 쓴다). 공백은 변환 뒤 null 이라
    // MissingPathVariableException 이 되어 500 이 났다.
    expectError(delete(URI.create("/api/v1/projects/X/saved-views/%20")), "id", "정수여야 합니다.");
  }

  @Test
  void 박스형_Long_경로변수_이름이_id_가_아니어도_그_이름으로_안내한다() throws Exception {
    // WP-1599: IssueCommentController.list — @PathVariable Long issueId
    expectError(get(URI.create("/api/v1/issues/%20/comments")), "issueId", "정수여야 합니다.");
  }

  @Test
  void 쓰기_경로_박스형_Long_에_공백을_넣어도_정수여야_합니다() throws Exception {
    // WP-1599: IssueCommentController.delete — @PathVariable Long commentId
    expectError(delete(URI.create("/api/v1/issues/1/comments/%20")), "commentId", "정수여야 합니다.");
  }

  @Test
  void 원시형_long_경로변수에_공백을_넣어도_정수여야_합니다() throws Exception {
    // WP-1599 회귀: 원시형은 MethodArgumentTypeMismatchException 경로 그대로 400
    expectError(get(URI.create("/api/v1/drive/files/%20/summary")), "id", "정수여야 합니다.");
  }

  @Test
  void UUID_경로변수에_공백을_넣으면_UUID_형식이어야_합니다() throws Exception {
    // WP-1599: HomeProposalController.pending — @PathVariable UUID sessionId
    expectError(
        get(URI.create("/api/v1/home/sessions/%20/proposals")), "sessionId", "UUID 형식이어야 합니다.");
  }

  /** 인증 헤더를 붙여 보내고 400·errors.&lt;field&gt; 안내 문구·예전 「…타입이어야 합니다」 꼬리가 없음을 확인한다. */
  private void expectError(MockHttpServletRequestBuilder req, String field, String message)
      throws Exception {
    mvc.perform(req.header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors." + field).value(message))
        .andExpect(content().string(Matchers.not(Matchers.containsString("타입이어야"))));
  }
}
