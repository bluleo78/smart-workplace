package com.workplace.airun.status;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AI_RUN;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1831 AI 현황 처리 이력 API 통합 테스트 — 두 출처(ai_run·위임 작업) 섞기·필터·키셋 페이지·대기/처리 시간·검증·상세·권한·RLS. 데이터는 모두
 * now 기준 상대 시각(기본 기간 30일 안)이다.
 */
@Transactional
class AiStatusRunsApiTest extends AiStatusTestSupport {

  private static final String URL = "/api/v1/admin/ai-status/runs";

  @Autowired ObjectMapper objectMapper;

  // ------------------------------------------------------------------ 헬퍼

  /** ai_run 한 건의 값 묶음 — 필요한 칸만 체이닝으로 채운다. */
  private final class Run {
    String kind = "AI_CHAT";
    String status = "SUCCEEDED";
    Instant startedAt = now.minus(Duration.ofHours(1));
    Long durationMs = 100L;
    Instant sourceAt;
    String targetLabel;
    String actorType;
    Long actorId;
    String model;
    String reason;
    String detail;
    Long inTok;
    Long outTok;
    Long cacheRead;
    Long cacheWrite;
    String credential;
    Integer attempt;
    UUID runId = UUID.randomUUID();
    long tenant = 1L;

    Run kind(String v) {
      kind = v;
      return this;
    }

    Run status(String v) {
      status = v;
      return this;
    }

    Run at(Instant v) {
      startedAt = v;
      return this;
    }

    Run ago(Duration d) {
      startedAt = now.minus(d);
      return this;
    }

    Run dur(Long v) {
      durationMs = v;
      return this;
    }

    Run source(Instant v) {
      sourceAt = v;
      return this;
    }

    Run label(String v) {
      targetLabel = v;
      return this;
    }

    Run actor(String type, Long id) {
      actorType = type;
      actorId = id;
      return this;
    }

    Run model(String v) {
      model = v;
      return this;
    }

    Run reason(String v) {
      reason = v;
      return this;
    }

    Run tokens(Long in, Long out) {
      inTok = in;
      outTok = out;
      return this;
    }

    /** 저장하고 ai_run.id(BIGSERIAL) 를 돌려준다. */
    long save() {
      useTenant(tenant);
      long id =
          baseDsl
              .insertInto(AI_RUN)
              .set(AI_RUN.TENANT_ID, tenant)
              .set(AI_RUN.RUN_ID, runId)
              .set(AI_RUN.KIND, kind)
              .set(AI_RUN.STATUS, status)
              .set(AI_RUN.STARTED_AT, utc(startedAt))
              .set(
                  AI_RUN.ENDED_AT,
                  durationMs == null ? null : utc(startedAt.plusMillis(durationMs)))
              .set(AI_RUN.SOURCE_AT, sourceAt == null ? null : utc(sourceAt))
              .set(AI_RUN.TARGET_TYPE, targetLabel == null ? null : "ISSUE")
              .set(AI_RUN.TARGET_ID, targetLabel == null ? null : "1")
              .set(AI_RUN.TARGET_LABEL, targetLabel)
              .set(AI_RUN.ACTOR_TYPE, actorType)
              .set(AI_RUN.ACTOR_ID, actorId)
              .set(AI_RUN.MODEL, model)
              .set(AI_RUN.ERROR_REASON, reason)
              .set(AI_RUN.ERROR_DETAIL, detail)
              .set(AI_RUN.INPUT_TOKENS, inTok)
              .set(AI_RUN.OUTPUT_TOKENS, outTok)
              .set(AI_RUN.CACHE_READ_TOKENS, cacheRead)
              .set(AI_RUN.CACHE_WRITE_TOKENS, cacheWrite)
              .set(AI_RUN.CREDENTIAL_LABEL, credential)
              .set(AI_RUN.ATTEMPT, attempt == null ? null : attempt.shortValue())
              .returning(AI_RUN.ID)
              .fetchOne()
              .getId();
      useTenant(1L);
      return id;
    }
  }

  private Run run() {
    return new Run();
  }

  /** 위임 작업 결과 — 만든 agent_work.id 와 이슈 키·작업자. */
  private record Work(long id, String issueKey, long workerId) {}

  /**
   * 위임 작업 한 건 — 배정(SUBMITTED) → waitMin 분 뒤 WORKING(null 이면 아직 시작 전) → state 가 끝난 상태면 workMin 분 뒤
   * 종료. 이슈 제목은 title.
   */
  private Work work(
      Instant assigned, String title, String state, Integer waitMin, Integer workMin) {
    String key = uniqueProjectKey("AR");
    long project = projectService.create(admin, new CreateProjectRequest(key, "P-ar", "x")).id();
    long issueId =
        IssueSeeds.insert(issueRepository, baseDsl, project, 1, title, null, "MID", null, admin)
            .id();
    long agent = createAgentUser("ar-agent");
    Instant realStart = waitMin == null ? null : assigned.plus(Duration.ofMinutes(waitMin));
    // agent_work 는 끝난 상태일 때만 ended_at 이 있다(CHECK) — 시작 없이 끝난 작업(취소 등)은 배정 1분 뒤에 끝난 것으로 둔다.
    boolean terminal = List.of("COMPLETED", "FAILED", "CANCELED", "REJECTED").contains(state);
    Instant end = null;
    if (terminal) {
      int workDurationMin = workMin == null ? 1 : workMin;
      end =
          realStart == null
              ? assigned.plus(Duration.ofMinutes(1))
              : realStart.plus(Duration.ofMinutes(workDurationMin));
    }
    long workId =
        baseDsl
            .insertInto(AGENT_WORK)
            .set(AGENT_WORK.TENANT_ID, 1L)
            .set(AGENT_WORK.ISSUE_ID, issueId)
            .set(AGENT_WORK.WORKER_ID, agent)
            .set(AGENT_WORK.STATE, state)
            .set(AGENT_WORK.STARTED_AT, utc(assigned))
            .set(AGENT_WORK.ENDED_AT, end == null ? null : utc(end))
            .set(AGENT_WORK.UPDATED_AT, utc(assigned))
            .set(AGENT_WORK.STATE_CHANGED_AT, utc(assigned))
            .returning(AGENT_WORK.ID)
            .fetchOne()
            .getId();
    event(workId, "SUBMITTED", assigned);
    if (realStart != null) {
      event(workId, "WORKING", realStart);
    }
    if (end != null) {
      event(workId, state, end);
    }
    return new Work(workId, key + "-1", agent);
  }

  /** 목록 호출 후 응답 JSON. */
  private JsonNode runs(String... nameValues) throws Exception {
    TenantContext.set(1L);
    MvcResult r = mvc.perform(req(URL, nameValues)).andExpect(status().isOk()).andReturn();
    return objectMapper.readTree(r.getResponse().getContentAsString());
  }

  private static List<String> ids(JsonNode page) {
    List<String> out = new ArrayList<>();
    page.get("items").forEach(i -> out.add(i.get("id").asString()));
    return out;
  }

  // ------------------------------------------------------------------ 섞기·정렬

  @Test
  void runs_mixesAiRunAndDelegated_byStartedAtDesc() throws Exception {
    run().ago(Duration.ofHours(3)).kind("MAIL_CLASSIFY").save();
    run().ago(Duration.ofHours(1)).kind("AI_CHAT").tokens(10L, 5L).save();
    Work w = work(now.minus(Duration.ofHours(2)), "위임 제목", "COMPLETED", 5, 10);

    JsonNode page = runs();

    JsonNode items = page.get("items");
    assertThat(items).hasSize(3);
    assertThat(items.get(0).get("kind").asString()).isEqualTo("AI_CHAT");
    JsonNode d = items.get(1);
    assertThat(d.get("kind").asString()).isEqualTo("DELEGATED_WORK");
    assertThat(d.get("id").asString()).isEqualTo("W-" + w.id());
    assertThat(d.get("target").get("type").asString()).isEqualTo("ISSUE");
    assertThat(d.get("target").get("id").asString()).isEqualTo(w.issueKey());
    assertThat(d.get("target").get("label").asString()).isEqualTo("위임 제목");
    assertThat(d.get("actor").get("type").asString()).isEqualTo("AGENT");
    assertThat(d.get("actor").get("id").asLong()).isEqualTo(w.workerId());
    assertThat(d.get("actor").get("name").asString()).isEqualTo("ar-agent");
    assertThat(d.get("status").asString()).isEqualTo("SUCCEEDED");
    assertThat(d.get("inputTokens").isNull()).isTrue();
    assertThat(d.get("model").isNull()).isTrue();
    assertThat(items.get(2).get("kind").asString()).isEqualTo("MAIL_CLASSIFY");
    assertThat(page.get("nextCursor").isNull()).isTrue();
  }

  // ------------------------------------------------------------------ 필터

  @Test
  void runs_filterKind_multi() throws Exception {
    run().kind("MAIL_CLASSIFY_BATCH").save();
    run().kind("AI_CHAT").save();
    run().kind("FILE_SUMMARY").save();
    work(now.minus(Duration.ofHours(2)), "t", "COMPLETED", 1, 1);

    JsonNode repeated = runs("kind", "MAIL_CLASSIFY_BATCH", "kind", "DELEGATED_WORK");
    JsonNode csv = runs("kind", "MAIL_CLASSIFY_BATCH,DELEGATED_WORK");

    for (JsonNode page : List.of(repeated, csv)) {
      assertThat(page.get("items")).hasSize(2);
      List<String> kinds = new ArrayList<>();
      page.get("items").forEach(i -> kinds.add(i.get("kind").asString()));
      assertThat(kinds).containsExactlyInAnyOrder("MAIL_CLASSIFY_BATCH", "DELEGATED_WORK");
    }
  }

  @Test
  void runs_filterKindWithoutDelegated_excludesDelegated() throws Exception {
    run().kind("AI_CHAT").save();
    work(now.minus(Duration.ofHours(2)), "t", "COMPLETED", 1, 1);

    JsonNode page = runs("kind", "AI_CHAT");

    assertThat(page.get("items")).hasSize(1);
    assertThat(page.get("items").get(0).get("kind").asString()).isEqualTo("AI_CHAT");
  }

  @Test
  void runs_filterStatus_mapsDelegated() throws Exception {
    run().status("SKIPPED").ago(Duration.ofHours(1)).save();
    run().status("SUCCEEDED").ago(Duration.ofHours(1)).save();
    Work canceled = work(now.minus(Duration.ofHours(2)), "t", "CANCELED", null, null);
    work(now.minus(Duration.ofHours(2)), "t", "COMPLETED", 1, 1);

    JsonNode page = runs("status", "SKIPPED");

    assertThat(page.get("items")).hasSize(2);
    assertThat(ids(page)).contains("W-" + canceled.id());
    page.get("items").forEach(i -> assertThat(i.get("status").asString()).isEqualTo("SKIPPED"));
  }

  @Test
  void runs_filterActorType_user() throws Exception {
    run().actor("USER", member).save();
    run().actor("AUTO", null).save();
    work(now.minus(Duration.ofHours(2)), "t", "COMPLETED", 1, 1);

    JsonNode page = runs("actorType", "USER");

    assertThat(page.get("items")).hasSize(1);
    JsonNode actor = page.get("items").get(0).get("actor");
    assertThat(actor.get("type").asString()).isEqualTo("USER");
    assertThat(actor.get("id").asLong()).isEqualTo(member);
    assertThat(actor.get("name").asString()).startsWith("human-");
  }

  @Test
  void runs_filterModel_excludesDelegated() throws Exception {
    run().model("claude-x").save();
    run().model("claude-y").save();
    work(now.minus(Duration.ofHours(2)), "t", "COMPLETED", 1, 1);

    JsonNode page = runs("model", "claude-x");

    assertThat(page.get("items")).hasSize(1);
    assertThat(page.get("items").get(0).get("model").asString()).isEqualTo("claude-x");
  }

  @Test
  void runs_filterQ_matchesTargetLabelAndErrorReason_andIssueTitle() throws Exception {
    Run byLabel = run().label("Quarterly Report");
    byLabel.save();
    Run byReason = run().reason("quarterly timeout");
    byReason.save();
    run().label("other").save();
    Work byTitle = work(now.minus(Duration.ofHours(2)), "QUARTERLY plan", "COMPLETED", 1, 1);
    work(now.minus(Duration.ofHours(2)), "unrelated", "COMPLETED", 1, 1);

    JsonNode page = runs("q", "quarterly");

    assertThat(page.get("items")).hasSize(3);
    assertThat(ids(page))
        .containsExactlyInAnyOrder(
            "R-" + byLabel.runId, "R-" + byReason.runId, "W-" + byTitle.id());
    // 이슈 키로도 찾는다.
    JsonNode byKey = runs("q", byTitle.issueKey().toLowerCase());
    assertThat(ids(byKey)).containsExactly("W-" + byTitle.id());
  }

  @Test
  void runs_qEscapesLikeWildcards() throws Exception {
    run().label("rate 50% off").save();
    run().label("count 500 items").save();
    run().label("a_b").save();
    run().label("axb").save();

    assertThat(runs("q", "50%").get("items")).hasSize(1);
    assertThat(runs("q", "a_b").get("items")).hasSize(1);
  }

  @Test
  void runs_filterFromTo() throws Exception {
    run().ago(Duration.ofHours(10)).kind("OLD").save();
    run().ago(Duration.ofHours(5)).kind("MID").save();
    run().ago(Duration.ofHours(1)).kind("NEW").save();
    String from = now.minus(Duration.ofHours(6)).toString();
    String to = now.minus(Duration.ofHours(1)).toString();

    JsonNode page = runs("from", from, "to", to);

    // to 는 포함하지 않는다(반열린 구간).
    assertThat(page.get("items")).hasSize(1);
    assertThat(page.get("items").get(0).get("kind").asString()).isEqualTo("MID");
  }

  // ------------------------------------------------------------------ 페이지

  @Test
  void runs_cursor_paginatesAllRows() throws Exception {
    for (int i = 1; i <= 4; i++) {
      run().ago(Duration.ofHours(i)).save();
    }
    work(now.minus(Duration.ofMinutes(30)), "t", "COMPLETED", 1, 1);

    List<Integer> sizes = new ArrayList<>();
    List<String> all = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 10; guard++) {
      JsonNode page = cursor == null ? runs("size", "2") : runs("size", "2", "cursor", cursor);
      sizes.add(page.get("items").size());
      all.addAll(ids(page));
      if (page.get("nextCursor").isNull()) {
        break;
      }
      cursor = page.get("nextCursor").asString();
    }

    assertThat(sizes).containsExactly(2, 2, 1);
    assertThat(all).doesNotHaveDuplicates().hasSize(5);
  }

  @Test
  void runs_cursorAcrossSameTimestamp_noDupNoGap() throws Exception {
    Instant same = now.minus(Duration.ofHours(1));
    run().at(same).save();
    run().at(same).save();
    work(same, "t", "COMPLETED", 1, 1);

    List<String> all = new ArrayList<>();
    String cursor = null;
    for (int guard = 0; guard < 10; guard++) {
      JsonNode page = cursor == null ? runs("size", "1") : runs("size", "1", "cursor", cursor);
      assertThat(page.get("items")).hasSize(1);
      all.addAll(ids(page));
      if (page.get("nextCursor").isNull()) {
        break;
      }
      cursor = page.get("nextCursor").asString();
    }

    assertThat(all).hasSize(3).doesNotHaveDuplicates();
  }

  // ------------------------------------------------------------------ 시간

  @Test
  void runs_waitAndDuration() throws Exception {
    Instant start = now.minus(Duration.ofHours(2));
    run().at(start).source(start.minusSeconds(30)).dur(2000L).label("with-source").save();
    run().ago(Duration.ofHours(3)).dur(null).status("RUNNING").label("running").save();
    run().ago(Duration.ofHours(4)).label("no-source").save();
    Work w = work(now.minus(Duration.ofHours(5)), "t", "COMPLETED", 5, 10);
    Work notStarted = work(now.minus(Duration.ofHours(6)), "t", "SUBMITTED", null, null);

    JsonNode items = runs().get("items");

    JsonNode withSource = byLabel(items, "with-source");
    assertThat(withSource.get("waitMs").asLong()).isEqualTo(30_000L);
    assertThat(withSource.get("durationMs").asLong()).isEqualTo(2000L);
    JsonNode running = byLabel(items, "running");
    assertThat(running.get("durationMs").isNull()).isTrue();
    assertThat(byLabel(items, "no-source").get("waitMs").isNull()).isTrue();
    JsonNode delegated = byId(items, "W-" + w.id());
    assertThat(delegated.get("waitMs").asLong()).isEqualTo(300_000L);
    assertThat(delegated.get("durationMs").asLong()).isEqualTo(600_000L);
    JsonNode pending = byId(items, "W-" + notStarted.id());
    assertThat(pending.get("waitMs").isNull()).isTrue();
    assertThat(pending.get("durationMs").isNull()).isTrue();
    // 실제 시작 전 행은 RUNNING 이 아니라 PENDING 으로 세어진다(WP-1831 리뷰 ③).
    assertThat(pending.get("status").asString()).isEqualTo("PENDING");
  }

  /** 실제 시작 전(status=PENDING) 위임 작업만 골라 낸다 — RUNNING 과 섞이지 않는다(WP-1831 리뷰 ③). */
  @Test
  void runs_filterStatus_pendingOnlyNotStartedWork() throws Exception {
    run().status("RUNNING").ago(Duration.ofHours(1)).save();
    Work notStarted = work(now.minus(Duration.ofHours(2)), "시작 전", "SUBMITTED", null, null);
    Work started = work(now.minus(Duration.ofHours(2)), "시작함", "WORKING", 1, null);

    JsonNode page = runs("status", "PENDING");

    assertThat(ids(page)).containsExactly("W-" + notStarted.id());
    assertThat(ids(runs("status", "RUNNING"))).doesNotContain("W-" + notStarted.id());
    assertThat(ids(runs("status", "RUNNING"))).contains("W-" + started.id());
  }

  /**
   * 위임 작업의 주체 종류는 작업자 user.kind 로 가른다 — 사람이 직접 일한 행도 AGENT 로 뭉뚱그리면 actorType=USER 필터에서 빠진다(WP-1831
   * 리뷰 ②).
   */
  @Test
  void runs_delegatedHumanWorker_actorTypeUser() throws Exception {
    Work human = work(now.minus(Duration.ofHours(2)), "사람 작업", "WORKING", 1, null);
    baseDsl
        .update(AGENT_WORK)
        .set(AGENT_WORK.WORKER_ID, member)
        .where(AGENT_WORK.ID.eq(human.id()))
        .execute();
    Work agent = work(now.minus(Duration.ofHours(3)), "AI 작업", "WORKING", 1, null);

    JsonNode userPage = runs("actorType", "USER");
    JsonNode agentPage = runs("actorType", "AGENT");

    assertThat(ids(userPage)).containsExactly("W-" + human.id());
    assertThat(userPage.get("items").get(0).get("actor").get("type").asString()).isEqualTo("USER");
    assertThat(ids(agentPage)).containsExactly("W-" + agent.id());
    assertThat(agentPage.get("items").get(0).get("actor").get("type").asString())
        .isEqualTo("AGENT");
  }

  private static JsonNode byLabel(JsonNode items, String label) {
    for (JsonNode i : items) {
      if (label.equals(i.get("target").get("label").asString())) {
        return i;
      }
    }
    throw new AssertionError("label 없음: " + label);
  }

  private static JsonNode byId(JsonNode items, String id) {
    for (JsonNode i : items) {
      if (id.equals(i.get("id").asString())) {
        return i;
      }
    }
    throw new AssertionError("id 없음: " + id);
  }

  // ------------------------------------------------------------------ 검증 400

  @Test
  void runs_invalidCursor_400() throws Exception {
    TenantContext.set(1L);
    mvc.perform(req(URL, "cursor", "not-a-cursor")).andExpect(status().isBadRequest());
  }

  @Test
  void runs_invalidStatus_400() throws Exception {
    TenantContext.set(1L);
    mvc.perform(req(URL, "status", "DONE")).andExpect(status().isBadRequest());
  }

  @Test
  void runs_invalidActorType_400() throws Exception {
    TenantContext.set(1L);
    mvc.perform(req(URL, "actorType", "ROBOT")).andExpect(status().isBadRequest());
  }

  @Test
  void runs_fromAfterTo_400() throws Exception {
    TenantContext.set(1L);
    mvc.perform(req(URL, "from", now.toString(), "to", now.minus(Duration.ofHours(1)).toString()))
        .andExpect(status().isBadRequest());
  }

  @Test
  void runs_size101_400() throws Exception {
    TenantContext.set(1L);
    mvc.perform(req(URL, "size", "101")).andExpect(status().isBadRequest());
    mvc.perform(req(URL, "size", "0")).andExpect(status().isBadRequest());
  }

  /**
   * 다른 테넌트의 위임 작업(agent_work) 한 건을 만들어 id 를 돌려준다. 그 테넌트 GUC 로 project(기본 상태 4행은 DB 트리거가 시드) → 이슈 유형
   * → 이슈 → 작업을 잇달아 넣는다 — IssueDomainRlsTest 와 같은 패턴. 테넌트 1 에 만든 행의 tenant_id 를 옮길 수는 없다(USING·WITH
   * CHECK 가 모두 GUC 와 같아야 해 0행이기 때문). user 테이블엔 RLS 가 없어 운영자(admin)를 소유자·작업자로 써도 된다.
   */
  private long otherTenantWork(long otherTenant) {
    useTenant(otherTenant);
    try {
      long project =
          baseDsl
              .insertInto(PROJECT)
              .set(PROJECT.KEY, uniqueProjectKey("XW"))
              .set(PROJECT.NAME, "other tenant project")
              .set(PROJECT.OWNER_ID, admin)
              .set(PROJECT.TENANT_ID, otherTenant)
              .returning(PROJECT.ID)
              .fetchOne()
              .getId();
      long typeId =
          baseDsl
              .insertInto(ISSUE_TYPE_DEF)
              .set(ISSUE_TYPE_DEF.PROJECT_ID, project)
              .set(ISSUE_TYPE_DEF.NAME, "TASK")
              .set(ISSUE_TYPE_DEF.COLOR_TOKEN, "BLUE")
              .set(ISSUE_TYPE_DEF.ICON, "Circle")
              .returning(ISSUE_TYPE_DEF.ID)
              .fetchOne()
              .getId();
      long issueId =
          baseDsl
              .insertInto(ISSUE)
              .set(ISSUE.PROJECT_ID, project)
              .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(project, "TODO"))
              .set(ISSUE.NUMBER, 1)
              .set(ISSUE.TITLE, "other-tenant-work")
              .set(ISSUE.STATUS, "TODO")
              .set(ISSUE.PRIORITY, "MID")
              .set(ISSUE.REPORTER_ID, admin)
              .set(ISSUE.TYPE_ID, typeId)
              .set(ISSUE.TENANT_ID, otherTenant)
              .returning(ISSUE.ID)
              .fetchOne()
              .getId();
      // 기간 안(2시간 전 배정)에 끝난 작업 — RLS 가 없으면 목록에 보일 모양이라 격리가 실제로 지켜지는지 본다.
      return baseDsl
          .insertInto(AGENT_WORK)
          .set(AGENT_WORK.TENANT_ID, otherTenant)
          .set(AGENT_WORK.ISSUE_ID, issueId)
          .set(AGENT_WORK.WORKER_ID, admin)
          .set(AGENT_WORK.STATE, "COMPLETED")
          .set(AGENT_WORK.STARTED_AT, utc(now.minus(Duration.ofHours(2))))
          .set(AGENT_WORK.ENDED_AT, utc(now.minus(Duration.ofHours(1))))
          .set(AGENT_WORK.UPDATED_AT, utc(now.minus(Duration.ofHours(1))))
          .set(AGENT_WORK.STATE_CHANGED_AT, utc(now.minus(Duration.ofHours(1))))
          .returning(AGENT_WORK.ID)
          .fetchOne()
          .getId();
    } finally {
      useTenant(1L);
    }
  }

  // ------------------------------------------------------------------ 상세

  @Test
  void runDetail_returnsErrorDetailAndTokens() throws Exception {
    UUID runId = UUID.randomUUID();
    Run r =
        run()
            .status("FAILED")
            .reason("timeout")
            .tokens(10L, 5L)
            .label("제목")
            .source(now.minus(Duration.ofHours(1)).minusSeconds(10));
    r.runId = runId;
    r.detail = "스택 트레이스";
    r.cacheRead = 7L;
    r.cacheWrite = 3L;
    r.credential = "cred-1";
    r.attempt = 2;
    r.save();
    TenantContext.set(1L);

    mvc.perform(req(URL + "/" + runId))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.runId").value(runId.toString()))
        .andExpect(jsonPath("$.item.id").value("R-" + runId))
        .andExpect(jsonPath("$.item.status").value("FAILED"))
        .andExpect(jsonPath("$.item.errorReason").value("timeout"))
        .andExpect(jsonPath("$.item.inputTokens").value(10))
        .andExpect(jsonPath("$.cacheReadTokens").value(7))
        .andExpect(jsonPath("$.cacheWriteTokens").value(3))
        .andExpect(jsonPath("$.credentialLabel").value("cred-1"))
        .andExpect(jsonPath("$.attempt").value(2))
        .andExpect(jsonPath("$.errorDetail").value("스택 트레이스"))
        .andExpect(jsonPath("$.sourceAt").exists());
  }

  @Test
  void runDetail_unknown_404() throws Exception {
    TenantContext.set(1L);
    mvc.perform(req(URL + "/" + UUID.randomUUID())).andExpect(status().isNotFound());
  }

  // ------------------------------------------------------------------ 권한·RLS

  @Test
  void runs_nonAdmin_403() throws Exception {
    TenantContext.set(1L);
    mvc.perform(get(URL).with(authentication(WebSessionAuth.of(member, List.of()))))
        .andExpect(status().isForbidden());
  }

  @Test
  void runs_otherTenantInvisible() throws Exception {
    long tid2 =
        baseDsl
            .fetchOne(
                "INSERT INTO tenant (slug, name, status) VALUES (?, 'RLS-AR', 'ACTIVE') RETURNING id",
                "rls-ar-" + System.nanoTime())
            .get("id", Long.class);
    run().kind("MINE").save();
    Run other = run().kind("THEIRS");
    other.tenant = tid2;
    other.save();
    // 다른 테넌트의 위임 작업도 목록·상세에 보이지 않아야 한다.
    long otherWork = otherTenantWork(tid2);
    TenantContext.set(1L);

    JsonNode page = runs();

    assertThat(page.get("items")).hasSize(1);
    assertThat(page.get("items").get(0).get("kind").asString()).isEqualTo("MINE");
    assertThat(ids(page)).doesNotContain("W-" + otherWork);
    mvc.perform(req(URL + "/" + other.runId)).andExpect(status().isNotFound());
  }
}
