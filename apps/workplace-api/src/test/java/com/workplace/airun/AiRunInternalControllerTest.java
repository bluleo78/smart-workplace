package com.workplace.airun;

import static com.workplace.jooq.Tables.AI_RUN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.airun.dto.AiRunBatchRequest;
import com.workplace.airun.dto.AiRunRecord;
import com.workplace.airun.repository.AiRunRepository;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1827 AI 처리 기록 내부 수신 엔드포인트·기록 서비스 통합 테스트.
 *
 * <p>컨트롤러가 테넌트별 독립 트랜잭션(REQUIRES_NEW)에 커밋하므로 테스트는 트랜잭션 밖에서 돈다 — 처리 ID 를 매번 새로 만들어 서로 겹치지 않는다.
 */
class AiRunInternalControllerTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/internal/ai-runs";
  private static final OffsetDateTime T0 =
      OffsetDateTime.of(2026, 11, 20, 10, 0, 0, 0, ZoneOffset.UTC);

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @Autowired AiRunRecorder recorder;
  @Autowired AiRunRepository repo;

  private static AiRunRecord rec(UUID id, Long tenant, String status, String kind) {
    return new AiRunRecord(
        id, tenant, kind, null, null, null, null, null, null, T0, null, null, null, null, null,
        null, null, status, null, null, null);
  }

  private ResultActions send(String auth, List<AiRunRecord> runs) throws Exception {
    var req = post(URL).contentType(MediaType.APPLICATION_JSON);
    if (auth != null) {
      req = req.header("Authorization", auth);
    }
    return mockMvc.perform(
        req.content(objectMapper.writeValueAsString(new AiRunBatchRequest(runs))));
  }

  private ResultActions sendOk(List<AiRunRecord> runs) throws Exception {
    return send("Internal test-token", runs);
  }

  /** 해당 테넌트의 TenantContext·트랜잭션으로 처리 ID 의 행 수를 센다(RLS 통과). */
  private int count(long tenantId, UUID id) {
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(s -> dsl.fetchCount(AI_RUN, AI_RUN.RUN_ID.eq(id)));
    } finally {
      TenantContext.clear();
    }
  }

  private String statusOf(long tenantId, UUID id) {
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager)
          .execute(
              s ->
                  dsl.select(AI_RUN.STATUS)
                      .from(AI_RUN)
                      .where(AI_RUN.RUN_ID.eq(id))
                      .fetchOne(0, String.class));
    } finally {
      TenantContext.clear();
    }
  }

  private long newTenant(String status) {
    return baseDsl
        .fetchOne(
            "INSERT INTO tenant (slug, name, status) VALUES (?, 'AIRUN-IT', ?) RETURNING id",
            "airun-it-" + System.nanoTime(),
            status)
        .get("id", Long.class);
  }

  @Test
  void post_validInternalToken_noOnBehalfOf_upsertsAndReturnsCounts() throws Exception {
    UUID id = UUID.randomUUID();
    sendOk(List.of(rec(id, 1L, "RUNNING", "AI_CHAT")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(1))
        .andExpect(jsonPath("$.dropped").value(0));
    assertThat(count(1L, id)).isEqualTo(1);
  }

  @Test
  void post_missingToken_401_nothingWritten() throws Exception {
    UUID id = UUID.randomUUID();
    send(null, List.of(rec(id, 1L, "RUNNING", "AI_CHAT"))).andExpect(status().isUnauthorized());
    assertThat(count(1L, id)).isZero();
  }

  @Test
  void post_wrongToken_401() throws Exception {
    UUID id = UUID.randomUUID();
    send("Internal wrong", List.of(rec(id, 1L, "RUNNING", "AI_CHAT")))
        .andExpect(status().isUnauthorized());
    assertThat(count(1L, id)).isZero();
  }

  @Test
  void post_bearerScheme_401() throws Exception {
    UUID id = UUID.randomUUID();
    send("Bearer test-token", List.of(rec(id, 1L, "RUNNING", "AI_CHAT")))
        .andExpect(status().isUnauthorized());
    assertThat(count(1L, id)).isZero();
  }

  @Test
  void post_emptyRuns_returnsZeroZero() throws Exception {
    sendOk(List.of())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(0))
        .andExpect(jsonPath("$.dropped").value(0));
  }

  @Test
  void post_over500_400() throws Exception {
    List<AiRunRecord> runs = new ArrayList<>();
    for (int i = 0; i < 501; i++) {
      runs.add(rec(UUID.randomUUID(), 1L, "RUNNING", "AI_CHAT"));
    }
    sendOk(runs).andExpect(status().isBadRequest());
  }

  @Test
  void post_mixedTenants_eachStoredInOwnTenant() throws Exception {
    long t2 = newTenant("ACTIVE");
    UUID a = UUID.randomUUID();
    UUID b = UUID.randomUUID();
    sendOk(List.of(rec(a, 1L, "RUNNING", "AI_CHAT"), rec(b, t2, "RUNNING", "AI_CHAT")))
        .andExpect(jsonPath("$.accepted").value(2));
    assertThat(count(1L, a)).isEqualTo(1);
    assertThat(count(t2, b)).isEqualTo(1);
    assertThat(count(1L, b)).isZero();
    assertThat(count(t2, a)).isZero();
  }

  @Test
  void post_inactiveOrUnknownTenant_droppedOthersStored() throws Exception {
    long suspended = newTenant("SUSPENDED");
    UUID ok = UUID.randomUUID();
    sendOk(
            List.of(
                rec(UUID.randomUUID(), 999999L, "RUNNING", "AI_CHAT"),
                rec(UUID.randomUUID(), suspended, "RUNNING", "AI_CHAT"),
                rec(ok, 1L, "RUNNING", "AI_CHAT")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accepted").value(1))
        .andExpect(jsonPath("$.dropped").value(2));
    assertThat(count(1L, ok)).isEqualTo(1);
  }

  @Test
  void post_noTenantOrNoStartedAtOrBadStatus_dropped() throws Exception {
    UUID noTenant = UUID.randomUUID();
    UUID noStart = UUID.randomUUID();
    UUID badStatus = UUID.randomUUID();
    UUID badKind = UUID.randomUUID();
    UUID noRun = null;
    AiRunRecord withoutStart =
        new AiRunRecord(
            noStart, 1L, "AI_CHAT", null, null, null, null, null, null, null, null, null, null,
            null, null, null, null, "RUNNING", null, null, null);
    sendOk(
            List.of(
                rec(noTenant, null, "RUNNING", "AI_CHAT"),
                withoutStart,
                rec(badStatus, 1L, "DONE", "AI_CHAT"),
                rec(badKind, 1L, "RUNNING", "ai-chat"),
                rec(noRun, 1L, "RUNNING", "AI_CHAT")))
        .andExpect(jsonPath("$.accepted").value(0))
        .andExpect(jsonPath("$.dropped").value(5));
    assertThat(count(1L, noStart)).isZero();
    assertThat(count(1L, badStatus)).isZero();
    assertThat(count(1L, badKind)).isZero();
  }

  @Test
  void post_sameRunIdTwiceInBatch_oneFailedRow() throws Exception {
    UUID id = UUID.randomUUID();
    sendOk(List.of(rec(id, 1L, "RUNNING", "AI_CHAT"), rec(id, 1L, "FAILED", "AI_CHAT")))
        .andExpect(jsonPath("$.accepted").value(2));
    assertThat(count(1L, id)).isEqualTo(1);
    assertThat(statusOf(1L, id)).isEqualTo("FAILED");
  }

  @Test
  void recorder_upsert_repositoryThrows_doesNotPropagate() {
    doThrow(new IllegalStateException("boom")).when(repo).upsert(any());
    recorder.upsert(rec(UUID.randomUUID(), 1L, "RUNNING", "AI_CHAT"));
    // 저장소까지 실제로 도달했는지 확인 — 일찍 반환해도 통과하던 것을 막는다.
    verify(repo).upsert(any());
  }

  /** 잘못된 status 한 건을 upsert 에 넘기면 저장하지 않고 예외도 던지지 않는다(ingest 와 같은 검사). */
  @Test
  void recorder_upsert_invalidRecord_droppedWithoutThrowing() {
    UUID id = UUID.randomUUID();
    recorder.upsert(rec(id, 1L, "BOGUS", "AI_CHAT"));
    assertThat(count(1L, id)).isZero();
  }

  /** I-1 — upsert 는 호출자의 TenantContext 를 지우지 않고 그대로 돌려놓으며 행도 저장한다. */
  @Test
  void recorder_upsert_preservesCallerTenantContext() {
    UUID id = UUID.randomUUID();
    TenantContext.set(1L);
    try {
      recorder.upsert(rec(id, null, "RUNNING", "AI_CHAT"));
      assertThat(TenantContext.get()).isEqualTo(1L);
    } finally {
      TenantContext.clear();
    }
    assertThat(count(1L, id)).isEqualTo(1);
  }

  /** 리뷰 후속 — 테넌트 상태 조회가 실패해도 그 테넌트 묶음만 버리고 다른 테넌트는 저장하며 예외를 던지지 않는다. */
  @Test
  void ingest_tenantStatusLookupThrows_dropsOnlyThatTenant() {
    var checker = mock(TenantStatusChecker.class);
    var runner = mock(TenantScopedRunner.class);
    when(checker.isActive(1L)).thenThrow(new IllegalStateException("db down"));
    when(checker.isActive(2L)).thenReturn(true);
    var isolated = new AiRunRecorder(repo, runner, checker);
    var result =
        isolated.ingest(
            List.of(
                rec(UUID.randomUUID(), 1L, "RUNNING", "AI_CHAT"),
                rec(UUID.randomUUID(), 2L, "RUNNING", "AI_CHAT")));
    assertThat(result.accepted()).isEqualTo(1);
    assertThat(result.dropped()).isEqualTo(1);
    verify(runner).runForTenant(eq(2L), any());
  }

  /** I-2 — 틀린 actorType 한 건만 버리고 같은 테넌트 묶음의 나머지는 저장한다. */
  @Test
  void post_badActorType_onlyThatRecordDropped() throws Exception {
    UUID bad = UUID.randomUUID();
    UUID good = UUID.randomUUID();
    UUID agent = UUID.randomUUID();
    AiRunRecord badActor = withActor(bad, "SYSTEM");
    sendOk(List.of(badActor, rec(good, 1L, "RUNNING", "AI_CHAT"), withActor(agent, "AGENT")))
        .andExpect(jsonPath("$.accepted").value(2))
        .andExpect(jsonPath("$.dropped").value(1));
    assertThat(count(1L, bad)).isZero();
    assertThat(count(1L, good)).isEqualTo(1);
    assertThat(count(1L, agent)).isEqualTo(1);
  }

  private static AiRunRecord withActor(UUID id, String actorType) {
    return new AiRunRecord(
        id, 1L, "AI_CHAT", null, null, null, actorType, null, null, T0, null, null, null, null,
        null, null, null, "RUNNING", null, null, null);
  }
}
