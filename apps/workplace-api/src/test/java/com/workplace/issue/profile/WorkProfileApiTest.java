package com.workplace.issue.profile;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.WorkProfileAiResult;
import com.workplace.issue.outbound.dto.WorkProfileAiResult.Classified;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.dto.ProjectResponse;
import com.workplace.project.service.ProjectService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1485 — 업무 프로파일 API 통합 테스트. 호출자 본인 것만 나오는지(userId 파라미터 무시), 하루 10번 상한(429), 잘못된 기간(400)·로그인
 * 필요(401)를 고정한다. 테스트 트랜잭션은 커밋되지 않아 워커가 돌지 않으므로 READY 는 {@code runAnalysis} 를 직접 불러 만든다.
 */
@Transactional
class WorkProfileApiTest extends ExternalClientMockedTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired WorkProfileService service;
  @Autowired WorkProfileRepository repository;
  @Autowired AiAgentIssueClient client;
  @Autowired AssistantResolver assistantResolver;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwtTokenProvider;

  @BeforeEach
  void assistant() {
    when(assistantResolver.resolveOrEmpty(anyLong()))
        .thenReturn(Optional.of(new AssistantSpec(999L, "m", "NONE", 8, 60_000)));
  }

  private Long user(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }

  /** 사용자가 지금 담당으로 끝낸 이슈 하나를 만들고 AI 분류로 READY 프로파일을 저장한다(점유 → 그 점유 토큰으로 워커 한 회). */
  private void readyProfile(Long me, String summary) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    ProjectResponse p =
        projectService.create(
            me, new CreateProjectRequest("WA" + suffix, "P-WA" + suffix, "x", "TEAM"));
    var created =
        issueService.create(
            me, p.key(), new CreateIssueRequest("끝낸 일", "본문", null, null, null, null, null, null));
    dsl.deleteFrom(ISSUE_ASSIGNEE).where(ISSUE_ASSIGNEE.ISSUE_ID.eq(created.id())).execute();
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .set(ISSUE.CLOSED_AT, OffsetDateTime.now())
        .where(ISSUE.ID.eq(created.id()))
        .execute();
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, created.id())
        .set(ISSUE_ASSIGNEE.USER_ID, me)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, me)
        .execute();
    String key = p.key() + "-" + created.number();
    when(client.analyzeWorkProfile(any()))
        .thenReturn(
            new WorkProfileAiResult(
                summary, List.of("Java"), List.of(new Classified(key, "기능 개발", "이슈"))));
    // 점유 토큰은 DB 정밀도(마이크로초)로 잘라야 워커의 저장 조건과 같게 비교된다.
    OffsetDateTime now = OffsetDateTime.now().truncatedTo(ChronoUnit.MICROS);
    repository.claimPending(me, MeOverviewPeriod.MONTH, now, now.minusMinutes(10));
    service.runAnalysis(
        me, MeOverviewPeriod.MONTH, now.atZoneSameInstant(IssueDueWindow.ZONE).toLocalDate(), now);
  }

  @Test
  void get_returnsOnlyCallersProfile_evenWithUserIdParam() throws Exception {
    Long a = user("wfa-a");
    Long b = user("wfa-b");
    readyProfile(a, "A 의 요약");

    mvc.perform(
            get("/api/v1/me/work-profile")
                .param("userId", String.valueOf(a))
                .header("Authorization", "Bearer " + tokenFor(b)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("NONE"))
        .andExpect(jsonPath("$.summary").value(nullValue()))
        .andExpect(content().string(not(containsString("A 의 요약"))));

    mvc.perform(get("/api/v1/me/work-profile").header("Authorization", "Bearer " + tokenFor(a)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("READY"))
        .andExpect(jsonPath("$.summary").value("A 의 요약"))
        .andExpect(jsonPath("$.tasks[0].name").value("기능 개발"))
        .andExpect(jsonPath("$.tasks").value(not(empty())));
  }

  @Test
  void analyze_returns429AfterTenPerDay() throws Exception {
    Long a = user("wfa-a");
    readyProfile(a, "요약");

    for (int i = 0; i < 10; i++) {
      mvc.perform(
              post("/api/v1/me/work-profile/analyze")
                  .header("Authorization", "Bearer " + tokenFor(a)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.outcome").value("UNCHANGED"));
    }
    mvc.perform(
            post("/api/v1/me/work-profile/analyze")
                .header("Authorization", "Bearer " + tokenFor(a)))
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.message").value("오늘은 더 분석할 수 없어요"));
  }

  @Test
  void rejects_unknown_period_and_requires_login() throws Exception {
    Long a = user("wfa-a");
    String auth = "Bearer " + tokenFor(a);

    mvc.perform(
            get("/api/v1/me/work-profile").param("period", "YEAR").header("Authorization", auth))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/v1/me/work-profile/analyze")
                .param("period", "YEAR")
                .header("Authorization", auth))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/api/v1/me/work-profile")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/v1/me/work-profile/analyze")).andExpect(status().isUnauthorized());
  }
}
