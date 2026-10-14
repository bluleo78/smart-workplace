package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 위임 작업 목록·건수 API(WP-377 §5.2) — GET /api/v1/me/ai-tasks, /counts. 실 JWT + MockMvc 로 범위(나와
 * 관련·전체)·급한 순 정렬·상태 필터·복합 커서 페이지 경계·건수를 검증한다. 테스트 트랜잭션 안에서 시드하고 롤백한다.
 */
@Transactional
class AiTasksControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueRepository issueRepository;

  /** 호출자(사람). */
  private long me;

  /** 같은 프로젝트의 다른 사람. */
  private long other;

  /** AI 구성원. */
  private long agent;

  /** 호출자가 소유한(=멤버인) 프로젝트. */
  private long projectId;

  /** 다음 이슈 번호. */
  private int nextNumber = 1;

  /** 웹 「완료」 칩이 보내는 종료 상태 묶음(WP-396). */
  private static final String DONE_STATES = "COMPLETED,FAILED,CANCELED,REJECTED";

  @BeforeEach
  void seedUsersAndProject() {
    me = createUser("ai-me");
    other = createUser("ai-ot");
    agent = createAgentUser("ai-agent");
    var project = projectService.create(me, new CreateProjectRequest(uniqueKey("AT"), "P-ai", "x"));
    projectId = project.id();
    projectMemberRepository.insert(projectId, other, "MEMBER");
  }

  // ---------------------------------------------------------------- 범위

  @Test
  void MINE_은_내가_만든_AI담당_이슈와_내가_AI도구로_작업중인_이슈() throws Exception {
    long a = issue("a", me);
    assign(a, agent);
    work(a, agent, "WORKING");
    long b = issue("b", other);
    work(b, me, "WORKING");
    long c = issue("c", other);
    assign(c, agent);
    work(c, agent, "WORKING");
    long d = issue("d", me);
    assign(d, me);
    long e = issue("e", other);
    work(e, other, "WORKING");
    // 내 작업이 이미 끝난 이슈는 진행 중이 아니므로 미완료(기본)에서 빠진다(완료 보기에 나온다).
    long f = issue("f", other);
    work(f, me, "WORKING");
    endWork(f);

    assertThat(titles(getJson("/api/v1/me/ai-tasks"))).containsExactlyInAnyOrder("a", "b");
  }

  /** WP-396: 작업 기록(agent_work)이 하나도 없는 AI 담당 이슈는 미완료에도 완료에도 나오지 않는다 — 열린 이슈든 닫힌 이슈든. */
  @Test
  void 작업기록이_없는_AI담당_이슈는_미완료에도_완료에도_없다() throws Exception {
    long open = issue("open-no-record", me);
    assign(open, agent);
    long closed = issue("closed-no-record", me);
    assign(closed, agent);
    setStatus(closed, "DONE");
    long live = issue("live", me);
    assign(live, agent);
    work(live, agent, "WORKING");

    assertThat(titles(getJson("/api/v1/me/ai-tasks?scope=ALL"))).containsExactly("live");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?scope=ALL&agentState=" + DONE_STATES)))
        .isEmpty();
    assertThat(counts("/api/v1/me/ai-tasks/counts?scope=ALL"))
        .containsEntry("all", 1)
        .containsEntry("done", 0);
  }

  @Test
  void MINE_은_내가_담당자_워커_보고자_중_하나이면_보인다_WP395() throws Exception {
    // 내가 만들고 AI 에게 맡김.
    long reportedByMeDelegated = issue("reported-me-delegated", me);
    assign(reportedByMeDelegated, agent);
    work(reportedByMeDelegated, agent, "WORKING");
    // 다른 사람 이슈를 내가 AI 도구로 작업.
    long othersIssueIWork = issue("others-issue-i-work", other);
    work(othersIssueIWork, me, "WORKING");
    // 내가 담당, 다른 사람이 AI 도구로 작업 — 지금까지는 안 보였던 경우.
    long assignedToMeOthersWork = issue("assigned-me-others-work", other);
    assign(assignedToMeOthersWork, me);
    work(assignedToMeOthersWork, other, "WORKING");
    // AI 와 내가 공동 담당(내가 만들지 않음) — 지금까지는 안 보였던 경우.
    long coAssignedWithAgent = issue("co-assigned-with-agent", other);
    assign(coAssignedWithAgent, agent);
    assign(coAssignedWithAgent, me);
    work(coAssignedWithAgent, agent, "WORKING");
    // 내가 만들고 다른 사람이 담당, 그 사람이 AI 도구로 작업 — 지금까지는 안 보였던 경우.
    long reportedByMeOthersWork = issue("reported-me-others-work", me);
    assign(reportedByMeOthersWork, other);
    work(reportedByMeOthersWork, other, "WORKING");
    // 음성 대조군 — 담당·워커·보고자 어디에도 내가 없으면 여전히 안 보임.
    long notMine = issue("not-mine", other);
    assign(notMine, agent);
    work(notMine, agent, "WORKING");

    assertThat(titles(getJson("/api/v1/me/ai-tasks")))
        .containsExactlyInAnyOrder(
            "reported-me-delegated",
            "others-issue-i-work",
            "assigned-me-others-work",
            "co-assigned-with-agent",
            "reported-me-others-work");
  }

  @Test
  void ALL_은_접근가능한_모든_AI_이슈_접근불가_프로젝트_제외() throws Exception {
    long a = issue("a", me);
    assign(a, agent);
    work(a, agent, "WORKING");
    long b = issue("b", other);
    work(b, me, "WORKING");
    long c = issue("c", other);
    assign(c, agent);
    work(c, agent, "WORKING");
    long d = issue("d", me);
    assign(d, me);
    long e = issue("e", other);
    work(e, other, "WORKING");
    // 호출자가 멤버가 아닌 프로젝트 — AI 담당·사람 작업이 있어도 보이지 않아야 한다.
    var priv =
        projectService.create(other, new CreateProjectRequest(uniqueKey("PV"), "P-priv", "x"));
    var x = issueRepository.insert(priv.id(), 1, "priv-x", null, "MID", null, other);
    assign(x.id(), agent);
    work(x.id(), agent, "WORKING");
    var y = issueRepository.insert(priv.id(), 2, "priv-y", null, "MID", null, other);
    work(y.id(), other, "INPUT_REQUIRED");

    assertThat(titles(getJson("/api/v1/me/ai-tasks?scope=all")))
        .containsExactlyInAnyOrder("a", "b", "c", "e");
  }

  // ---------------------------------------------------------------- 정렬·필터

  @Test
  void 급한순_정렬_답변필요_검토필요_막힘_작업중_일시중지() throws Exception {
    // 일부러 급한 순과 다른 순서로 만든다. 작업 기록 없는 AI 담당 이슈(none)는 목록 밖(WP-396).
    long none = issue("none", me);
    assign(none, agent);
    work(issue("paused", other), me, "PAUSED");
    work(issue("working", other), me, "WORKING");
    work(issue("blocked", other), me, "BLOCKED");
    work(issue("review", other), me, "REVIEW");
    work(issue("inputRequired", other), me, "INPUT_REQUIRED");

    var items = getJson("/api/v1/me/ai-tasks").get("items");
    List<String> states = new ArrayList<>();
    items.forEach(
        it -> states.add(it.has("agentWork") ? it.at("/agentWork/0/state").asText() : null));
    assertThat(states).containsExactly("INPUT_REQUIRED", "REVIEW", "BLOCKED", "WORKING", "PAUSED");
  }

  @Test
  void 같은_순위는_마지막_보고_최근순() throws Exception {
    long older = issue("older", other);
    work(older, me, "WORKING", Instant.parse("2026-10-01T00:00:00Z"));
    long newer = issue("newer", other);
    work(newer, me, "WORKING", Instant.parse("2026-10-02T00:00:00Z"));
    // 한 이슈에 여러 작업이면 가장 급한 상태가 순위 — AI 구성원 INPUT_REQUIRED 가 사람 WORKING 보다 앞선다.
    long mixed = issue("mixed", me);
    assign(mixed, agent);
    work(mixed, me, "WORKING");
    work(mixed, agent, "INPUT_REQUIRED");

    assertThat(titles(getJson("/api/v1/me/ai-tasks"))).containsExactly("mixed", "newer", "older");
  }

  @Test
  void agentState_필터는_진행중_작업_상태로_거르고_모르는_값은_무시() throws Exception {
    work(issue("inputRequired", other), me, "INPUT_REQUIRED");
    work(issue("review", other), me, "REVIEW");
    work(issue("working", other), me, "WORKING");
    long done = issue("done", other);
    work(done, me, "WORKING");
    endWork(done);

    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=INPUT_REQUIRED, REVIEW")))
        .containsExactlyInAnyOrder("inputRequired", "review");
    // 모르는 값만 오면 필터 없음(=미완료 기본 보기) — 종료된 작업만 있는 이슈는 빠진다.
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=NOPE")))
        .containsExactlyInAnyOrder("inputRequired", "review", "working");
  }

  // ---------------------------------------------------------------- 완료 보기(WP-396)

  /**
   * 완료 보기 = 진행 중 작업이 없고 종료 작업이 있는 이슈. 대표 작업(agentWork[0])은 가장 최근 종료 1건이고, 최근 종료순으로 정렬한다. 진행 중 작업이
   * 하나라도 남은 이슈는 종료 작업이 있어도 미완료 쪽에만 나온다(두 보기는 배타적).
   */
  @Test
  void 완료_보기는_진행중_작업이_없고_종료작업이_있는_이슈만_최근종료순() throws Exception {
    long completed = issue("completed", me);
    assign(completed, agent);
    endedWork(completed, agent, "COMPLETED", Instant.parse("2026-10-03T00:00:00Z"));
    long failed = issue("failed", me);
    assign(failed, agent);
    endedWork(failed, agent, "FAILED", Instant.parse("2026-10-05T00:00:00Z"));
    // 먼저 실패했다가 나중에 다시 일해 완료 — 대표는 가장 최근 종료(COMPLETED).
    long retried = issue("retried", me);
    assign(retried, agent);
    endedWork(retried, agent, "FAILED", Instant.parse("2026-10-01T00:00:00Z"));
    endedWork(retried, agent, "COMPLETED", Instant.parse("2026-10-04T00:00:00Z"));
    // 반려(REJECTED) — 사람 작업자(나)가 AI 도구로 하다 끝낸 이슈도 "나와 관련" 완료에 든다.
    long rejected = issue("rejected", other);
    endedWork(rejected, me, "REJECTED", Instant.parse("2026-10-02T00:00:00Z"));
    // 취소 — 남의 사람 작업은 MINE 범위 밖.
    long othersCanceled = issue("others-canceled", other);
    endedWork(othersCanceled, other, "CANCELED", Instant.parse("2026-10-06T00:00:00Z"));
    // 종료 작업 + 진행 중 작업이 함께 있으면 미완료.
    long mixed = issue("mixed", me);
    assign(mixed, agent);
    endedWork(mixed, agent, "COMPLETED", Instant.parse("2026-10-07T00:00:00Z"));
    work(mixed, me, "WORKING");

    JsonNode body = getJson("/api/v1/me/ai-tasks?agentState=" + DONE_STATES);
    assertThat(titles(body)).containsExactly("failed", "retried", "completed", "rejected");
    List<String> states = new ArrayList<>();
    body.get("items").forEach(it -> states.add(it.at("/agentWork/0/state").asText()));
    assertThat(states).containsExactly("FAILED", "COMPLETED", "COMPLETED", "REJECTED");
    // 종료 작업은 대표 1건만 싣는다.
    body.get("items").forEach(it -> assertThat(it.get("agentWork")).hasSize(1));

    assertThat(titles(getJson("/api/v1/me/ai-tasks"))).containsExactly("mixed");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?scope=ALL&agentState=" + DONE_STATES)))
        .containsExactly("others-canceled", "failed", "retried", "completed", "rejected");
    assertThat(counts("/api/v1/me/ai-tasks/counts"))
        .containsEntry("all", 1)
        .containsEntry("done", 4);
  }

  /**
   * 나와 관련(ASSISTED)은 보기의 현재 국면에 맞는 내 작업으로 판정한다 — 내가 예전에 끝낸 이슈를 지금 남이 작업 중이면 내 미완료가 아니고(남의 일), 완료로도
   * 보이지 않는다(진행 중 작업이 있으므로).
   */
  @Test
  void 내가_끝낸_이슈를_남이_다시_작업중이면_나와_관련_어느_보기에도_없다() throws Exception {
    long x = issue("x", other);
    endedWork(x, me, "COMPLETED", Instant.parse("2026-10-01T00:00:00Z"));
    work(x, other, "WORKING");

    assertThat(titles(getJson("/api/v1/me/ai-tasks"))).isEmpty();
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=" + DONE_STATES))).isEmpty();
    assertThat(counts("/api/v1/me/ai-tasks/counts")).isEqualTo(counts(0, 0, 0, 0, 0, 0));
    // 전체 범위에서는 남의 진행 중 작업으로 미완료에 보인다.
    assertThat(titles(getJson("/api/v1/me/ai-tasks?scope=ALL"))).containsExactly("x");
  }

  /** 이슈 완료가 한 문장으로 닫은 작업(같은 종료 시각) — 착수 전이라 취소된 행보다 실제 결과(완료)를 대표로 고른다. */
  @Test
  void 같은_시각에_닫힌_작업이면_취소보다_실제_결과를_대표로() throws Exception {
    long i = issue("i", me);
    assign(i, agent);
    Instant at = Instant.parse("2026-10-05T00:00:00Z");
    endedWork(i, agent, "COMPLETED", at);
    // id 가 더 큰 취소 행 — id 동률 깨기만으로는 이쪽이 대표가 된다.
    endedWork(i, other, "CANCELED", at);

    var item = getJson("/api/v1/me/ai-tasks?agentState=" + DONE_STATES).get("items").get(0);
    assertThat(item.at("/agentWork/0/state").asText()).isEqualTo("COMPLETED");
  }

  /**
   * 대표 종료 작업은 행을 걸리게 한 조건 안에서 고른다 — 나와 관련 범위의 사람 작업 이슈면 내 작업만, 요청한 종료 상태 안에서만. 정렬 시각도 그 대표의 종료
   * 시각이고, 응답에 종료 시각(endedAt)이 실린다.
   */
  @Test
  void 대표_종료작업은_행을_걸리게_한_조건_안에서_고르고_종료시각을_싣는다() throws Exception {
    // 남의 이슈 — 나는 반려(10-02), 다른 사람은 나중에 취소(10-06). 나와 관련에서는 내 반려가 대표.
    long assisted = issue("assisted", other);
    endedWork(assisted, me, "REJECTED", Instant.parse("2026-10-02T00:00:00Z"));
    endedWork(assisted, other, "CANCELED", Instant.parse("2026-10-06T00:00:00Z"));
    // AI 담당 — 실패(10-03) 후 재시도 완료(10-04). 실패만 요청하면 대표도 실패, 정렬도 실패 시각.
    long retried = issue("retried", me);
    assign(retried, agent);
    endedWork(retried, agent, "FAILED", Instant.parse("2026-10-03T00:00:00Z"));
    endedWork(retried, agent, "COMPLETED", Instant.parse("2026-10-04T00:00:00Z"));

    JsonNode all = getJson("/api/v1/me/ai-tasks?agentState=" + DONE_STATES);
    assertThat(titles(all)).containsExactly("retried", "assisted");
    assertThat(all.at("/items/0/agentWork/0/state").asText()).isEqualTo("COMPLETED");
    assertThat(all.at("/items/0/agentWork/0/endedAt").asText()).isEqualTo("2026-10-04T00:00:00Z");
    assertThat(all.at("/items/1/agentWork/0/state").asText()).isEqualTo("REJECTED");
    assertThat(all.at("/items/1/agentWork/0/worker/id").asLong()).isEqualTo(me);

    JsonNode failed = getJson("/api/v1/me/ai-tasks?agentState=FAILED");
    assertThat(titles(failed)).containsExactly("retried");
    assertThat(failed.at("/items/0/agentWork/0/state").asText()).isEqualTo("FAILED");
    assertThat(failed.at("/items/0/agentWork/0/endedAt").asText())
        .isEqualTo("2026-10-03T00:00:00Z");
  }

  /**
   * WP-395 범위(보고자·담당자·작업자)는 완료 보기에도 같다. 대표 종료 작업은 행을 걸리게 한 근거의 후보 안에서 — 내가 담당한 이슈면 그 이슈의 사람 작업 중
   * 최근, 내가 작업자로만 걸린 이슈면 내 작업 중 최근.
   */
  @Test
  void 완료_보기도_담당자를_나와_관련에_포함하고_대표는_걸린_근거의_후보에서() throws Exception {
    // 내가 담당, 다른 사람이 AI 도구로 끝냄(취소 10-06) — 내 반려(10-02)보다 최근인 남의 작업이 대표.
    long assignedToMe = issue("assigned-me", other);
    assign(assignedToMe, me);
    endedWork(assignedToMe, me, "REJECTED", Instant.parse("2026-10-02T00:00:00Z"));
    endedWork(assignedToMe, other, "CANCELED", Instant.parse("2026-10-06T00:00:00Z"));
    // AI 와 내가 공동 담당(내가 만들지 않음) — AI 의 완료.
    long coAssigned = issue("co-assigned", other);
    assign(coAssigned, agent);
    assign(coAssigned, me);
    endedWork(coAssigned, agent, "COMPLETED", Instant.parse("2026-10-05T00:00:00Z"));
    // 담당·보고자 아님 — 다른 사람이 끝낸 작업만 있으면 나와 관련 밖.
    long notMine = issue("not-mine", other);
    endedWork(notMine, other, "COMPLETED", Instant.parse("2026-10-07T00:00:00Z"));

    JsonNode body = getJson("/api/v1/me/ai-tasks?agentState=" + DONE_STATES);
    assertThat(titles(body)).containsExactly("assigned-me", "co-assigned");
    assertThat(body.at("/items/0/agentWork/0/state").asText()).isEqualTo("CANCELED");
    assertThat(body.at("/items/0/agentWork/0/worker/id").asLong()).isEqualTo(other);
    assertThat(body.at("/items/1/agentWork/0/state").asText()).isEqualTo("COMPLETED");
    assertThat(counts("/api/v1/me/ai-tasks/counts")).containsEntry("done", 2);
  }

  /** 미완료 보기 행은 진행 중 작업만 싣는다 — 종료 시각(endedAt)도, 예전 종료 작업도 섞이지 않는다. */
  @Test
  void 미완료_보기_행에는_종료작업이_섞이지_않는다() throws Exception {
    long i = issue("i", me);
    assign(i, agent);
    endedWork(i, agent, "FAILED", Instant.parse("2026-10-01T00:00:00Z"));
    work(i, agent, "WORKING");

    JsonNode body = getJson("/api/v1/me/ai-tasks");
    assertThat(titles(body)).containsExactly("i");
    assertThat(body.at("/items/0/agentWork")).hasSize(1);
    assertThat(body.at("/items/0/agentWork/0/state").asText()).isEqualTo("WORKING");
    assertThat(body.at("/items/0/agentWork/0").has("endedAt")).isFalse();
  }

  @Test
  void 완료_보기도_커서로_나눠_받으면_한번에_받은_순서와_같다() throws Exception {
    for (int i = 0; i < 5; i++) {
      long t = issue("d" + i, me);
      assign(t, agent);
      // 둘씩 같은 종료 시각 — id 로 동률을 깬다.
      endedWork(t, agent, "COMPLETED", Instant.parse("2026-10-0" + (1 + i / 2) + "T00:00:00Z"));
    }
    String base = "/api/v1/me/ai-tasks?agentState=" + DONE_STATES;
    List<String> all = titles(getJson(base + "&size=100"));
    assertThat(all).hasSize(5);

    List<String> paged = new ArrayList<>();
    String cursor = null;
    int pages = 0;
    do {
      JsonNode page = getJson(base + "&size=2" + (cursor == null ? "" : "&cursor=" + cursor));
      paged.addAll(titles(page));
      cursor = page.get("hasMore").asBoolean() ? page.get("nextCursor").asText() : null;
      assertThat(++pages).as("페이지 순회가 끝나지 않는다").isLessThan(10);
    } while (cursor != null);
    assertThat(paged).isEqualTo(all);
  }

  @Test
  void status_priority_필터() throws Exception {
    long todo = issue("todo", other);
    work(todo, me, "WORKING");
    long doing = issue("doing", other);
    work(doing, me, "WORKING");
    setStatus(doing, "IN_PROGRESS");
    dsl.update(ISSUE).set(ISSUE.PRIORITY, "HIGH").where(ISSUE.ID.eq(todo)).execute();

    assertThat(titles(getJson("/api/v1/me/ai-tasks?status=IN_PROGRESS"))).containsExactly("doing");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?priority=HIGH"))).containsExactly("todo");
  }

  // ---------------------------------------------------------------- 커서

  @Test
  void 페이지_경계에서_중복_누락_없음() throws Exception {
    // 앞쪽 3행: 진행 중 작업이 있어 순위가 앞선다(첫 경계에서 rank > r 분기를 탄다).
    work(issue("w1", other), me, "INPUT_REQUIRED");
    work(issue("r1", other), me, "REVIEW");
    work(issue("k1", other), me, "WORKING");
    // 뒤쪽 5행: 일시 중지 AI 작업 — 같은 순위·같은 마지막 보고 시각(마이크로초 포함). 두 번째 경계가 이들 사이를 자른다(id 동률 깨기).
    Instant same = Instant.parse("2026-10-14T01:02:03.123456Z");
    for (int i = 0; i < 5; i++) {
      long t = issue("t" + i, me);
      assign(t, agent);
      work(t, agent, "PAUSED", same);
    }

    List<String> expected = titles(getJson("/api/v1/me/ai-tasks?scope=ALL&size=100"));
    assertThat(expected).hasSize(8);

    List<String> seen = new ArrayList<>();
    String cursor = null;
    int pages = 0;
    do {
      var page =
          getJson(
              "/api/v1/me/ai-tasks?scope=ALL&size=3" + (cursor == null ? "" : "&cursor=" + cursor));
      seen.addAll(titles(page));
      cursor = page.get("hasMore").asBoolean() ? page.get("nextCursor").asText() : null;
      assertThat(++pages).as("페이지 순회가 끝나지 않는다").isLessThan(10);
    } while (cursor != null);

    assertThat(seen).doesNotHaveDuplicates().containsExactlyElementsOf(expected);
  }

  @Test
  void 잘못된_커서_400() throws Exception {
    assertThat(status("/api/v1/me/ai-tasks?cursor=zzz")).isEqualTo(400);
    // base64 로는 맞지만 형식이 다른 커서(기존 이슈 커서 모양)도 400.
    String issueCursorLike =
        java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("123:45".getBytes());
    assertThat(status("/api/v1/me/ai-tasks?cursor=" + issueCursorLike)).isEqualTo(400);
  }

  // ---------------------------------------------------------------- 에픽 묶음(WP-375)

  /** 묶음 시드 기준 시각 — 실제 시각과 무관하게 고정한다. */
  private static final Instant REF = Instant.parse("2026-10-14T03:00:00Z");

  /** 에픽 묶음 시드에서 만든 이슈 id. */
  private record EpicSeed(long e, long c1, long c2, long c3, long s1, long s2) {}

  /**
   * 에픽 E(작업 중, t-50분) 아래 C1(답변 필요, t-40분)·C2(검토 필요, t-30분)·C3(완료, 담당·작업 없음 — 목록 밖, 하위 수에만 든다), 단독
   * S1(막힘, t-5분)·S2(답변 필요, t-60분). 모두 내가 만든 AI 담당 이슈라 "나와 관련" 범위.
   */
  private EpicSeed seedEpicGroup() {
    long epicType = epicTypeId();
    long e = issue("E", me);
    setType(e, epicType);
    long c1 = issue("C1", me);
    long c2 = issue("C2", me);
    long c3 = issue("C3", me);
    for (long c : List.of(c1, c2, c3)) setParent(c, e);
    setStatus(c3, "DONE");
    long s1 = issue("S1", me);
    long s2 = issue("S2", me);
    for (long id : List.of(e, c1, c2, s1, s2)) assign(id, agent);
    work(e, agent, "WORKING", REF.minus(Duration.ofMinutes(50)));
    work(c1, agent, "INPUT_REQUIRED", REF.minus(Duration.ofMinutes(40)));
    work(c2, agent, "REVIEW", REF.minus(Duration.ofMinutes(30)));
    work(s1, agent, "BLOCKED", REF.minus(Duration.ofMinutes(5)));
    work(s2, agent, "INPUT_REQUIRED", REF.minus(Duration.ofMinutes(60)));
    return new EpicSeed(e, c1, c2, c3, s1, s2);
  }

  @Test
  void 에픽_묶음은_연속이고_가장_급한_행_순위로_자리잡으며_머리가_먼저() throws Exception {
    EpicSeed s = seedEpicGroup();

    // E 묶음 순위 = min(작업중 4, 답변 필요 0, 검토 2) = 0, 최근 = t-30분. S2 도 순위 0 이지만 t-60분이라 뒤, S1(막힘 3)이 맨 뒤.
    JsonNode body = getJson("/api/v1/me/ai-tasks?size=100");
    assertThat(titles(body)).containsExactly("E", "C1", "C2", "S2", "S1");
    JsonNode items = body.get("items");
    JsonNode head = items.get(0).get("aiGroup");
    assertThat(head.get("epicNumber").asInt()).isEqualTo(number(s.e()));
    assertThat(head.get("size").asInt()).isEqualTo(3);
    assertThat(head.get("epicChildCount").asInt()).isEqualTo(3); // C1·C2·C3
    assertThat(head.get("epicChildDoneCount").asInt()).isEqualTo(1); // C3
    // 하위 행도 같은 묶음 정보를 싣는다.
    assertThat(items.get(1).at("/aiGroup/epicNumber").asInt()).isEqualTo(number(s.e()));
    assertThat(items.get(2).at("/aiGroup/size").asInt()).isEqualTo(3);
    // 비에픽 단독 행은 aiGroup 생략.
    assertThat(items.get(3).has("aiGroup")).isFalse();
    assertThat(items.get(4).has("aiGroup")).isFalse();
  }

  @Test
  void 부모가_에픽이_아니면_묶지_않고_각자_단독() throws Exception {
    // 비에픽(TASK) 부모 아래 하위 — 묶음 키가 각자 자기 id 라 개별 정렬, aiGroup 없음.
    long p = issue("P", me);
    long k = issue("K", me);
    setParent(k, p);
    assign(p, agent);
    assign(k, agent);
    work(p, agent, "WORKING", REF.minus(Duration.ofMinutes(10)));
    work(k, agent, "INPUT_REQUIRED", REF.minus(Duration.ofMinutes(20)));

    JsonNode body = getJson("/api/v1/me/ai-tasks?size=100");
    assertThat(titles(body)).containsExactly("K", "P");
    body.get("items").forEach(it -> assertThat(it.has("aiGroup")).isFalse());
  }

  @Test
  void 커서로_나눠_받아도_한번에_받은_순서와_같다() throws Exception {
    seedEpicGroup();

    List<String> all = titles(getJson("/api/v1/me/ai-tasks?size=100"));
    // 크기 1·2 둘 다 — 묶음 안(머리↔하위)과 묶음 사이 경계를 모두 자른다.
    for (int size : List.of(1, 2)) {
      List<String> paged = new ArrayList<>();
      String cursor = null;
      int pages = 0;
      do {
        JsonNode page =
            getJson(
                "/api/v1/me/ai-tasks?size=" + size + (cursor == null ? "" : "&cursor=" + cursor));
        paged.addAll(titles(page));
        // 페이지가 달라도 묶음 크기는 필터 적용 후 전체 기준이다.
        page.get("items")
            .forEach(
                it -> {
                  if (it.has("aiGroup")) assertThat(it.at("/aiGroup/size").asInt()).isEqualTo(3);
                });
        cursor = page.get("hasMore").asBoolean() ? page.get("nextCursor").asText() : null;
        assertThat(++pages).as("페이지 순회가 끝나지 않는다").isLessThan(20);
      } while (cursor != null);
      assertThat(paged).as("size=" + size).isEqualTo(all);
    }
  }

  @Test
  void 빠른_필터를_켜면_걸러진_행끼리만_묶는다() throws Exception {
    EpicSeed s = seedEpicGroup();

    // 답변 필요만: C1(t-40분, 묶음 E 의 유일한 행) 이 S2(t-60분) 보다 앞. 에픽 행이 빠져도 C1 은 에픽 묶음 정보를 싣는다.
    JsonNode body = getJson("/api/v1/me/ai-tasks?agentState=INPUT_REQUIRED&size=100");
    assertThat(titles(body)).containsExactly("C1", "S2");
    JsonNode g = body.get("items").get(0).get("aiGroup");
    assertThat(g.get("epicNumber").asInt()).isEqualTo(number(s.e()));
    assertThat(g.get("size").asInt()).isEqualTo(1);
    assertThat(g.get("epicChildCount").asInt()).isEqualTo(3);
    assertThat(body.get("items").get(1).has("aiGroup")).isFalse();
  }

  @Test
  void 이전_형식_커서는_400() throws Exception {
    String old =
        java.util.Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(("1|" + REF + "|5").getBytes(java.nio.charset.StandardCharsets.UTF_8));
    assertThat(status("/api/v1/me/ai-tasks?cursor=" + old)).isEqualTo(400);
  }

  // ---------------------------------------------------------------- 건수·응답

  @Test
  void counts_는_범위와_이슈상태_필터를_따르고_agentState_는_무시() throws Exception {
    work(issue("inputRequired", other), me, "INPUT_REQUIRED");
    work(issue("review", other), me, "REVIEW");
    work(issue("blocked", other), me, "BLOCKED");
    long working = issue("working", other);
    work(working, me, "WORKING");
    setStatus(working, "IN_PROGRESS");
    // 남의 작업 — MINE 건수에서는 빠지고 ALL 에서는 잡힌다.
    work(issue("others", other), other, "INPUT_REQUIRED");
    // 종료 작업만 있는 이슈 — 미완료(all)가 아니라 완료(done)로 센다.
    long done = issue("done", other);
    endedWork(done, me, "COMPLETED", Instant.parse("2026-10-01T00:00:00Z"));

    assertThat(counts("/api/v1/me/ai-tasks/counts?agentState=INPUT_REQUIRED"))
        .isEqualTo(counts(4, 1, 1, 1, 1, 1));
    assertThat(counts("/api/v1/me/ai-tasks/counts?scope=ALL")).isEqualTo(counts(5, 2, 1, 1, 1, 1));
    assertThat(counts("/api/v1/me/ai-tasks/counts?status=IN_PROGRESS"))
        .isEqualTo(counts(1, 0, 0, 0, 1, 0));
  }

  /** 막힘 칩은 BLOCKED + AUTH_REQUIRED 합. SUBMITTED·PAUSED 는 칩이 없고 전체(all)에만 든다. */
  @Test
  void counts_의_blocked_는_AUTH_REQUIRED_를_포함하고_SUBMITTED_PAUSED_는_칩없음() throws Exception {
    work(issue("blocked", other), me, "BLOCKED");
    work(issue("auth", other), me, "AUTH_REQUIRED");
    work(issue("paused", other), me, "PAUSED");
    work(issue("submitted", other), me, "SUBMITTED");

    assertThat(counts("/api/v1/me/ai-tasks/counts")).isEqualTo(counts(4, 0, 0, 2, 0, 0));
    // 목록 필터는 값 하나하나로 거른다 — 칩(막힘)은 클라이언트가 두 값을 함께 보낸다.
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=BLOCKED,AUTH_REQUIRED")))
        .containsExactlyInAnyOrder("blocked", "auth");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=SUBMITTED")))
        .containsExactly("submitted");
  }

  /** 급한 순: 인증 필요(1)는 답변 필요(0) 다음, 검토 필요(2) 앞. 시작 전(SUBMITTED)은 일시 중지 다음. */
  @Test
  void 급한순_인증필요와_시작전_위치() throws Exception {
    work(issue("submitted", other), me, "SUBMITTED");
    work(issue("review", other), me, "REVIEW");
    work(issue("auth", other), me, "AUTH_REQUIRED");
    work(issue("paused", other), me, "PAUSED");
    work(issue("input", other), me, "INPUT_REQUIRED");

    assertThat(titles(getJson("/api/v1/me/ai-tasks")))
        .containsExactly("input", "auth", "review", "paused", "submitted");
  }

  @Test
  void 종료된_이슈에_남은_진행중_행은_순위_건수_범위에_반영되지_않는다() throws Exception {
    // AI 담당 + 고아 INPUT_REQUIRED 행이 남은 DONE 이슈 — 진행 중 작업으로 치지 않고, 종료 기록도 없어 어느 보기에도 없다.
    long closed = issue("closed", me);
    assign(closed, agent);
    work(closed, agent, "INPUT_REQUIRED");
    setStatus(closed, "DONE");
    // 사람 고아 행만 있는 DONE 이슈 — 내 작업(ASSISTED)이어도 미완료로 들어오면 안 된다.
    long humanOrphan = issue("human-orphan", other);
    work(humanOrphan, me, "WORKING");
    setStatus(humanOrphan, "DONE");
    long open = issue("open", me);
    assign(open, agent);
    work(open, agent, "WORKING");

    assertThat(titles(getJson("/api/v1/me/ai-tasks"))).containsExactly("open");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=INPUT_REQUIRED"))).isEmpty();
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=" + DONE_STATES))).isEmpty();
    assertThat(counts("/api/v1/me/ai-tasks/counts")).isEqualTo(counts(1, 0, 0, 0, 1, 0));
  }

  @Test
  void 응답_항목에_agentWork_와_projectKey_포함() throws Exception {
    long b = issue("b", other);
    work(b, me, "REVIEW");

    var item = getJson("/api/v1/me/ai-tasks").get("items").get(0);
    assertThat(item.get("projectKey").asText()).startsWith("AT");
    assertThat(item.at("/agentWork/0/state").asText()).isEqualTo("REVIEW");
    assertThat(item.at("/agentWork/0/tool").asText()).isEqualTo("claude-code");
    assertThat(item.at("/agentWork/0/worker/kind").asText()).isEqualTo("HUMAN");
  }

  // ---------------------------------------------------------------- helpers

  /** USER 역할이 부여된 사람 사용자 시드. */
  private long createUser(String prefix) {
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

  private static String uniqueKey(String prefix) {
    return prefix + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
  }

  /** 호출자 프로젝트에 이슈를 만든다(제목으로 식별). */
  private long issue(String title, long reporter) {
    return issueRepository.insert(projectId, nextNumber++, title, null, "MID", null, reporter).id();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, me)
        .execute();
  }

  private void work(long issueId, long workerId, String state) {
    work(issueId, workerId, state, Instant.parse("2026-10-10T00:00:00Z"));
  }

  /** 진행 중 작업 시드 — 마지막 보고 시각을 지정한다. */
  private void work(long issueId, long workerId, String state, Instant updatedAt) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, state)
        .set(AGENT_WORK.UPDATED_AT, updatedAt.atOffset(ZoneOffset.UTC))
        .execute();
  }

  /** 종료된 작업 시드 — 종료 상태·종료 시각을 지정한다(마지막 보고 시각도 같게). */
  private void endedWork(long issueId, long workerId, String state, Instant endedAt) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, state)
        .set(AGENT_WORK.UPDATED_AT, endedAt.atOffset(ZoneOffset.UTC))
        .set(AGENT_WORK.ENDED_AT, endedAt.atOffset(ZoneOffset.UTC))
        .execute();
  }

  private void endWork(long issueId) {
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.STATE, "COMPLETED")
        .set(AGENT_WORK.ENDED_AT, OffsetDateTime.now())
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .execute();
  }

  /** 이 프로젝트의 EPIC 유형 id(프로젝트 생성 시 시스템 유형으로 시드됨). */
  private long epicTypeId() {
    return dsl.select(ISSUE_TYPE_DEF.ID)
        .from(ISSUE_TYPE_DEF)
        .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId).and(ISSUE_TYPE_DEF.NAME.eq("EPIC")))
        .fetchOne(ISSUE_TYPE_DEF.ID);
  }

  /** 유형 직접 갱신 — 규칙 검사 없이 모양만 만든다. */
  private void setType(long issueId, long typeId) {
    dsl.update(ISSUE).set(ISSUE.TYPE_ID, typeId).where(ISSUE.ID.eq(issueId)).execute();
  }

  /** 부모 직접 갱신 — 규칙 검사 없이 모양만 만든다. */
  private void setParent(long issueId, long parentId) {
    dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, parentId).where(ISSUE.ID.eq(issueId)).execute();
  }

  /** 이슈 번호(응답의 epicNumber 와 비교). */
  private int number(long issueId) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issueId)).fetchOne(ISSUE.NUMBER);
  }

  private void setStatus(long issueId, String status) {
    dsl.update(ISSUE).set(ISSUE.STATUS, status).where(ISSUE.ID.eq(issueId)).execute();
  }

  private MvcResult perform(String url) throws Exception {
    return mvc.perform(
            get(url)
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(me, "user-" + me)))
        .andReturn();
  }

  private int status(String url) throws Exception {
    return perform(url).getResponse().getStatus();
  }

  private JsonNode getJson(String url) throws Exception {
    var res = perform(url).getResponse();
    String body = res.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    assertThat(res.getStatus()).as(body).isEqualTo(200);
    return om.readTree(body);
  }

  private static List<String> titles(JsonNode page) {
    List<String> out = new ArrayList<>();
    page.get("items").forEach(it -> out.add(it.get("title").asText()));
    return out;
  }

  /** 기대 건수 맵 — 응답 필드 순서(미완료 all·답변·검토·막힘·작업 중·완료 done). */
  private static Map<String, Integer> counts(
      int all, int inputRequired, int review, int blocked, int working, int done) {
    return Map.of(
        "all", all,
        "inputRequired", inputRequired,
        "review", review,
        "blocked", blocked,
        "working", working,
        "done", done);
  }

  @SuppressWarnings("unchecked")
  private Map<String, Integer> counts(String url) throws Exception {
    return om.convertValue(getJson(url), Map.class);
  }
}
