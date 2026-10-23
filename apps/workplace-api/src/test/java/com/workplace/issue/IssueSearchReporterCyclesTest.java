package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE_CYCLE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.cycle.dto.CreateCycleRequest;
import com.workplace.cycle.service.CycleService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.LocalDate;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-270: 이슈 목록 검색 응답(GET /projects/{key}/issues)이 항목마다 보고자(UserSummary)와 연결된 사이클 요약을 싣는지 검증.
 *
 * <p>목록 열 고르기에서 「보고자」「사이클」 열을 상세 조회 없이 그리려면 목록 응답에 이름·종류와 사이클 이름이 같이 와야 한다. 사이클이 없는 이슈는 빈 배열이고,
 * AI(AGENT)가 만든 이슈는 kind=AGENT 로 내려가 배지를 붙일 수 있어야 한다.
 */
@Transactional
class IssueSearchReporterCyclesTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired CycleService cycleService;
  @Autowired IssueRepository issueRepository;

  /**
   * 보고자 + 사이클 2개 연결 이슈는 reporter 와 cycles(시작일 최신순)가 실리고, AGENT 보고자 + 사이클 없음 이슈는 cycles 가 빈 배열이다.
   */
  @Test
  void list_includesReporterAndCycles() throws Exception {
    long viewerId = createUser("rc-v", "HUMAN");
    long agentId = createUser("rc-ai", "AGENT");
    String key = uniqueKey("RC");
    var proj = projectService.create(viewerId, new CreateProjectRequest(key, "RC", "x"));
    var withCycles =
        IssueSeeds.insert(
            issueRepository, dsl, proj.id(), 1, "사이클 있는 이슈", null, "MID", null, viewerId);
    IssueSeeds.insert(issueRepository, dsl, proj.id(), 2, "AI 가 만든 이슈", null, "MID", null, agentId);

    // 정렬 확인용으로 시작일을 달리한다 — 최신 시작일이 먼저(start_date desc).
    var older =
        cycleService.create(
            viewerId,
            key,
            new CreateCycleRequest("스프린트 1", null, LocalDate.of(2026, 9, 1), null, null));
    var newer =
        cycleService.create(
            viewerId,
            key,
            new CreateCycleRequest("스프린트 2", null, LocalDate.of(2026, 10, 1), null, null));
    for (var c : new Long[] {older.id(), newer.id()}) {
      dsl.insertInto(ISSUE_CYCLE)
          .set(ISSUE_CYCLE.ISSUE_ID, withCycles.id())
          .set(ISSUE_CYCLE.CYCLE_ID, c)
          .execute();
    }

    mvc.perform(
            get("/api/v1/projects/" + key + "/issues")
                .header("Authorization", "Bearer " + tokenFor(viewerId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[?(@.number == 1)].reporter.id").value((int) viewerId))
        .andExpect(jsonPath("$.items[?(@.number == 1)].reporter.name").value("rc-v"))
        .andExpect(jsonPath("$.items[?(@.number == 1)].reporter.kind").value("HUMAN"))
        .andExpect(jsonPath("$.items[?(@.number == 1)].cycles[0].name").value("스프린트 2"))
        .andExpect(jsonPath("$.items[?(@.number == 1)].cycles[1].name").value("스프린트 1"))
        .andExpect(jsonPath("$.items[?(@.number == 1)].cycles[0].status").exists())
        .andExpect(jsonPath("$.items[?(@.number == 2)].reporter.name").value("rc-ai"))
        .andExpect(jsonPath("$.items[?(@.number == 2)].reporter.kind").value("AGENT"))
        // 필터 결과는 [[]] 로 한 겹 싸여 온다 — cycles 키는 있되(빈 배열) 첫 원소는 없다.
        .andExpect(jsonPath("$.items[?(@.number == 2)].cycles").exists())
        .andExpect(jsonPath("$.items[?(@.number == 2)].cycles[0]").doesNotExist());
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────

  /** 테스트용 USER(kind 지정) + USER_ROLE("USER") + 현재 테넌트 ACTIVE 멤버십 직접 삽입. */
  private long createUser(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    // WP-420: 역할 권한은 같은 테넌트의 ACTIVE 멤버일 때만 유효하다.
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    return id;
  }

  /** 프로젝트 key 충돌 방지용 고유 키 생성. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  /** userId 용 access token 발급 (Bearer 헤더 본문). */
  private String tokenFor(long userId) {
    return jwtTokenProvider.generateAccessToken(userId, "user-" + userId);
  }
}
