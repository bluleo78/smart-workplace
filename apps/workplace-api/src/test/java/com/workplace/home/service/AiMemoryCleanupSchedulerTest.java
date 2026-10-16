package com.workplace.home.service;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.AI_MEMORY;
import static com.workplace.jooq.Tables.AI_MEMORY_CHANGE;
import static com.workplace.jooq.Tables.AI_MEMORY_FORGOTTEN;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.global.tenant.TenantContext;
import com.workplace.home.AiMemoryTestFixtures;
import com.workplace.home.dto.AiMemoryItem;
import com.workplace.home.dto.CreateAiMemoryRequest;
import com.workplace.home.dto.UndoAiMemoryRequest;
import com.workplace.home.dto.UpdateAiMemoryRequest;
import com.workplace.home.exception.MemoryCleanupAiException;
import com.workplace.home.outbound.AiAgentMemoryCleanupClient;
import com.workplace.home.outbound.MemoryCleanupMessages.MemoryRef;
import com.workplace.home.outbound.MemoryCleanupMessages.Op;
import com.workplace.home.outbound.MemoryCleanupMessages.Request;
import com.workplace.home.outbound.MemoryCleanupMessages.Result;
import com.workplace.home.repository.AiMemoryCleanupRepository;
import com.workplace.home.repository.AiMemoryRepository.Row;
import com.workplace.home.service.SessionCleanupInput.Utterance;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.AiPreferenceService;
import java.net.http.HttpTimeoutException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

/**
 * WP-385 AiMemoryCleanupScheduler 통합 — 대상 선정(30분·7일·경계), 건너뛰기(메모리 꺼짐·비서 없음·짧은 대화), 입력 조립(경계 뒤 발화·AI
 * 답 300자·도구 결과·위젯 제외·이 대화가 저장한 메모리), 경계는 수집 때의 마지막 id, 실패 3회, 장애 중단, WP-386 참여자 훅. ai-agent 는 가짜
 * 클라이언트.
 *
 * <p>비-@Transactional: 예약 작업이 테넌트별·단계별 트랜잭션을 따로 연다(PriorityClassificationSchedulerTest 와 같은 방식). 공유
 * DB 에 다른 테스트가 남긴 세션이 있을 수 있어, 이 테스트의 대화는 마지막 메시지를 며칠 전으로 돌려 오래된 순 처리에서 먼저 오게 하고, 요청은 대화마다 넣은 고유
 * 표식으로 골라 본다.
 */
@DisplayName("AiMemoryCleanupScheduler 통합")
class AiMemoryCleanupSchedulerTest extends IntegrationTestBase {

  /** 20자를 넘는 사용자 발화. */
  private static final String LONG = "나 이번 분기부터 WP 프로젝트 배포를 맡았어";

  @Autowired AiMemoryCleanupScheduler scheduler;
  @Autowired AiMemoryCleanupRepository cleanupRepo;
  @Autowired HomeSessionService sessions;
  @Autowired AiMemoryService memoryService;
  @Autowired AiPreferenceService preferences;
  @Autowired AssistantResolver assistantResolver;
  @Autowired WorkspaceAssistantRepository workspaceAssistantRepo;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired AiMemoryUndoService undoService;

  @MockitoBean AiAgentMemoryCleanupClient client;
  @MockitoBean SessionCleanupParticipant participant;

  private final List<Long> users = new ArrayList<>();
  private long wsAgentId;

  @BeforeEach
  void setUp() {
    TenantContext.set(1L);
    long admin = TestFixtures.createHuman(baseDsl);
    wsAgentId = TestFixtures.createAgentWithToken(baseDsl, credentialService, admin);
    inTenant(
        () -> {
          workspaceAssistantRepo.upsert(wsAgentId, admin);
          return null;
        });
    users.add(admin);
    users.add(wsAgentId);
    when(client.cleanup(any())).thenReturn(new Result(List.of()));
    when(participant.prepare(any())).thenReturn(SessionCleanupParticipant.Prepared.NONE);
  }

  @AfterEach
  void tearDown() {
    cleanupInTenant(1L, workspaceAssistantRepo::deleteAssistant);
    cleanupInTenant(
        1L,
        () -> {
          baseDsl.deleteFrom(AI_MEMORY_CHANGE).where(AI_MEMORY_CHANGE.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(AI_MEMORY).where(AI_MEMORY.USER_ID.in(users)).execute();
          baseDsl
              .deleteFrom(AI_MEMORY_FORGOTTEN)
              .where(AI_MEMORY_FORGOTTEN.USER_ID.in(users))
              .execute();
          baseDsl.deleteFrom(HOME_SESSION).where(HOME_SESSION.USER_ID.in(users)).execute();
          baseDsl
              .deleteFrom(AI_AGENT_CREDENTIAL)
              .where(
                  AI_AGENT_CREDENTIAL
                      .USER_ID
                      .in(users)
                      .or(AI_AGENT_CREDENTIAL.CREATED_BY.in(users)))
              .execute();
          baseDsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(users)).execute();
          baseDsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
    TenantContext.clear();
  }

  private <T> T inTenant(Supplier<T> work) {
    return new TransactionTemplate(txManager).execute(s -> work.get());
  }

  private long user() {
    long uid = TestFixtures.createHuman(baseDsl);
    users.add(uid);
    return uid;
  }

  /** 메시지 하나를 더한다(사용자 소유 확인을 거치는 실제 경로). */
  private long append(long uid, UUID sid, String role, String content) {
    return inTenant(() -> sessions.appendMessage(uid, sid, role, content, null, null, null));
  }

  /** 대화 하나 — roleContent 는 (역할, 본문) 쌍. 마지막 메시지 시각을 ago 전으로 돌린다. */
  private UUID conversation(long uid, Duration ago, String... roleContent) {
    UUID sid = inTenant(() -> sessions.create(uid).id());
    for (int i = 0; i < roleContent.length; i += 2)
      append(uid, sid, roleContent[i], roleContent[i + 1]);
    idle(sid, ago);
    return sid;
  }

  private void idle(UUID sid, Duration ago) {
    inTenant(
        () ->
            baseDsl
                .update(HOME_SESSION)
                .set(HOME_SESSION.LAST_MESSAGE_AT, OffsetDateTime.now(ZoneOffset.UTC).minus(ago))
                .where(HOME_SESSION.ID.eq(sid))
                .execute());
  }

  private Long processed(UUID sid) {
    return inTenant(
        () ->
            baseDsl
                .select(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID)
                .from(HOME_SESSION)
                .where(HOME_SESSION.ID.eq(sid))
                .fetchOne(HOME_SESSION.MEMORY_PROCESSED_MESSAGE_ID));
  }

  private short failures(UUID sid) {
    return inTenant(
        () ->
            baseDsl
                .select(HOME_SESSION.MEMORY_CLEANUP_FAILURES)
                .from(HOME_SESSION)
                .where(HOME_SESSION.ID.eq(sid))
                .fetchOne(HOME_SESSION.MEMORY_CLEANUP_FAILURES));
  }

  private long lastMessageId(UUID sid) {
    return inTenant(
        () ->
            baseDsl
                .select(org.jooq.impl.DSL.max(HOME_MESSAGE.ID))
                .from(HOME_MESSAGE)
                .where(HOME_MESSAGE.SESSION_ID.eq(sid))
                .fetchOne(0, Long.class));
  }

  /** 본인 메모리(새 트랜잭션에서 읽는다 — 적용 트랜잭션이 정말 커밋됐는지 본다). */
  private List<Row> memories(long uid) {
    return inTenant(() -> AiMemoryTestFixtures.allMemories(baseDsl, uid));
  }

  /** 이 대화에 memory 블록 하나를 단 답을 남기고 그 답의 id. */
  private long answerWithBlock(
      long uid, UUID sid, com.fasterxml.jackson.databind.node.ObjectNode block) {
    String blocks = "[" + block + "]";
    return inTenant(
        () -> sessions.appendMessage(uid, sid, "ASSISTANT", "기억해 둘게요.", null, null, blocks));
  }

  /** 이 표식을 담은 요청인가. */
  private static boolean carries(Request r, String marker) {
    return r != null && r.utterances().stream().anyMatch(u -> u.contains(marker));
  }

  @Test
  void 쉬고_있는_최근_대화만_대상이고_처리한_대화는_빠진다() {
    long uid = user();
    UUID idleOne = conversation(uid, Duration.ofDays(3), "USER", LONG);
    UUID active = conversation(uid, Duration.ofMinutes(10), "USER", LONG);
    UUID tooOld = conversation(uid, Duration.ofDays(8), "USER", LONG);
    UUID done = conversation(uid, Duration.ofDays(3), "USER", LONG);
    long doneUpto = lastMessageId(done);
    inTenant(() -> cleanupRepo.markProcessed(done, null, doneUpto));
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);

    List<UUID> got =
        inTenant(() -> cleanupRepo.findTargets(now.minusMinutes(30), now.minusDays(7), 10_000))
            .stream()
            .map(AiMemoryCleanupRepository.Target::sessionId)
            .toList();

    assertThat(got).contains(idleOne).doesNotContain(active, tooOld, done);
  }

  @Test
  void 메모리가_꺼진_사용자는_부르지_않고_처리_완료로_표시한다() {
    long uid = user();
    preferences.update(uid, null, false);
    String marker = "꺼짐-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);

    scheduler.runAllTenants();

    verify(client, never()).cleanup(argThat(r -> carries(r, marker)));
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  /** WP-386 스펙 6.3: 메모리를 끈 사용자의 대화는 공용 추출도 하지 않는다(참여자를 부르지 않는다). */
  @Test
  void 메모리가_꺼진_사용자는_공용_추출_참여자도_부르지_않는다() {
    long uid = user();
    preferences.update(uid, null, false);
    String marker = "꺼짐공용-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);

    scheduler.runAllTenants();

    verify(participant, never()).prepare(argThat(in -> in != null && in.sessionId().equals(sid)));
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  @Test
  void 비서가_없으면_부르지_않고_처리_완료로_표시한다() {
    cleanupInTenant(1L, workspaceAssistantRepo::deleteAssistant);
    long uid = user();
    String marker = "비서없음-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);

    scheduler.runAllTenants();

    verify(client, never()).cleanup(argThat(r -> carries(r, marker)));
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  @Test
  void 새_사용자_발화가_20자_미만이면_부르지_않고_처리_완료로_표시한다() {
    long uid = user();
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", "고마워", "ASSISTANT", "x".repeat(500));

    scheduler.runAllTenants();

    verify(client, never()).cleanup(argThat(r -> carries(r, "고마워")));
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  @Test
  void 경계_뒤_발화와_AI_답_앞부분과_이_대화가_저장한_메모리를_보내고_도구_결과는_뺀다() {
    long uid = user();
    String marker = "조립-" + uid;
    UUID sid =
        conversation(uid, Duration.ofDays(6), "USER", "경계 앞 발화 " + marker, "ASSISTANT", "경계 앞 답");
    long boundary = lastMessageId(sid);
    inTenant(() -> cleanupRepo.markProcessed(sid, null, boundary));
    AiMemoryItem saved =
        memoryService.create(
            uid, new CreateAiMemoryRequest("CONTEXT", "백엔드 팀이다", "AI", sid, null, null), true);
    append(uid, sid, "USER", LONG + " " + marker);
    inTenant(
        () ->
            sessions.appendMessage(
                uid,
                sid,
                "ASSISTANT",
                "y".repeat(400),
                "[{\"type\":\"issue_list\",\"params\":{\"note\":\"위젯 비밀\"}}]",
                "[{\"name\":\"get_issue\",\"result\":\"도구 결과 비밀\"}]",
                null));
    append(uid, sid, "USER", "배포 순서는 API 먼저야");
    idle(sid, Duration.ofDays(6));
    ArgumentCaptor<Request> cap = ArgumentCaptor.forClass(Request.class);

    scheduler.runAllTenants();

    verify(client, atLeastOnce()).cleanup(cap.capture());
    Request req =
        cap.getAllValues().stream().filter(r -> carries(r, marker)).findFirst().orElseThrow();
    assertThat(req.utterances()).containsExactly(LONG + " " + marker, "배포 순서는 API 먼저야");
    assertThat(req.assistantNotes()).hasSize(1);
    assertThat(req.assistantNotes().get(0).after()).isZero();
    assertThat(req.assistantNotes().get(0).text()).isEqualTo("y".repeat(300));
    assertThat(String.join(" ", req.utterances()) + req.assistantNotes())
        .doesNotContain("도구 결과 비밀")
        .doesNotContain("위젯 비밀")
        .doesNotContain("경계 앞");
    assertThat(req.memories()).extracting(MemoryRef::id).contains(saved.id());
    assertThat(req.agentId()).isEqualTo(wsAgentId);
    assertThat(req.model())
        .isEqualTo(
            inTenant(() -> assistantResolver.resolveOrEmpty(uid)).orElseThrow().suggestionModel());
    assertThat(req.timeoutMs()).isEqualTo(30_000);
    assertThat(req.today()).isEqualTo(LocalDate.now(AiMemoryClock.ZONE).toString());
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  @Test
  void 수집_뒤에_온_메시지는_다음_회차로_남는다() {
    long uid = user();
    String marker = "경합-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    long upto = lastMessageId(sid);
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenAnswer(
            inv -> {
              append(uid, sid, "USER", "정리 중에 보낸 새 메시지");
              return new Result(List.of());
            });

    scheduler.runAllTenants();

    assertThat(processed(sid)).isEqualTo(upto);
    assertThat(lastMessageId(sid)).isGreaterThan(upto);
  }

  @Test
  void ai_agent_가_오류를_내면_표시하지_않고_세며_세_번째에_처리_완료로_표시한다() {
    long uid = user();
    String marker = "실패-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenThrow(
            new MemoryCleanupAiException(
                "실패", new HttpServerErrorException(HttpStatus.BAD_GATEWAY)));

    scheduler.runAllTenants();
    assertThat(processed(sid)).isNull();
    assertThat(failures(sid)).isEqualTo((short) 1);

    scheduler.runAllTenants();
    assertThat(failures(sid)).isEqualTo((short) 2);

    scheduler.runAllTenants();
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
    assertThat(failures(sid)).isZero();
  }

  @Test
  void ai_agent_읽기_시간_초과는_세션_실패로_세고_세_번째에_처리_완료로_표시한다() {
    long uid = user();
    String marker = "시간초과-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenThrow(
            new MemoryCleanupAiException(
                "시간 초과",
                new ResourceAccessException(
                    "read timed out", new HttpTimeoutException("response"))));

    scheduler.runAllTenants();
    assertThat(processed(sid)).isNull();
    assertThat(failures(sid)).isEqualTo((short) 1);

    scheduler.runAllTenants();
    assertThat(processed(sid)).isNull();
    assertThat(failures(sid)).isEqualTo((short) 2);

    scheduler.runAllTenants();
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
    assertThat(failures(sid)).isZero();
  }

  @Test
  void ai_agent_연결이_안_되면_세지_않고_세_번_연속이면_회차를_멈춘다() {
    long uid = user();
    String marker = "장애-" + uid;
    List<UUID> sids = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      // 오래된 순으로 처리되도록 하루 안에서 차이를 둔다(6일 전, 6일 전 − 1시간 …).
      sids.add(
          conversation(uid, Duration.ofDays(6).minusHours(i), "USER", LONG + marker + "-" + i));
    }
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenThrow(
            new MemoryCleanupAiException("불가", new ResourceAccessException("connection refused")));

    scheduler.runAllTenants();

    verify(client, times(3)).cleanup(argThat(r -> carries(r, marker)));
    for (UUID sid : sids) {
      assertThat(processed(sid)).isNull();
      assertThat(failures(sid)).isZero();
    }
  }

  @Test
  void 참여자_훅은_같은_입력을_받고_502_실패는_실패로_세며_경계를_올리지_않는다() {
    long uid = user();
    String marker = "훅장애-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    when(participant.prepare(argThat(in -> in != null && in.sessionId().equals(sid))))
        .thenThrow(
            new MemoryCleanupAiException(
                "공용 추출 실패", new HttpServerErrorException(HttpStatus.BAD_GATEWAY)));
    ArgumentCaptor<SessionCleanupInput> cap = ArgumentCaptor.forClass(SessionCleanupInput.class);

    scheduler.runAllTenants();

    verify(participant, atLeastOnce()).prepare(cap.capture());
    SessionCleanupInput in =
        cap.getAllValues().stream()
            .filter(i -> i.sessionId().equals(sid))
            .findFirst()
            .orElseThrow();
    assertThat(in.userId()).isEqualTo(uid);
    assertThat(in.tenantId()).isEqualTo(1L);
    assertThat(in.uptoId()).isEqualTo(lastMessageId(sid));
    assertThat(in.utterances()).extracting(Utterance::text).containsExactly(LONG + marker);
    assertThat(processed(sid)).isNull();
    assertThat(failures(sid)).isEqualTo((short) 1);
  }

  @Test
  void 참여자_준비는_개인_정리와_같은_적용_트랜잭션에서_적용된다() {
    long uid = user();
    String marker = "훅적용-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    AtomicBoolean inTx = new AtomicBoolean(false);
    when(participant.prepare(argThat(in -> in != null && in.sessionId().equals(sid))))
        .thenReturn(() -> inTx.set(TransactionSynchronizationManager.isActualTransactionActive()));

    scheduler.runAllTenants();

    assertThat(inTx).isTrue();
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  // 최종 리뷰 4(Review Focus 4): 검증 예외가 적용 트랜잭션을 rollback-only 로 만들면 회차 전체가 사라진다 — 실제 커밋을 거쳐 확인한다.
  @Test
  void 틀린_op_여러_개와_좋은_ADD_하나면_ADD_는_커밋되고_경계가_오른다() {
    long uid = user();
    String marker = "틀린op-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    long upto = lastMessageId(sid);
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenReturn(
            new Result(
                List.of(
                    new Op("ADD", null, "x".repeat(301), "PREFERENCE", null, null, 0, "r"),
                    new Op("ADD", null, "범위가 틀림", "PREFERENCE", "FOO", null, 0, "r"),
                    new Op("ADD", null, "지난 기한", "PREFERENCE", null, "2020-01-01", 0, "r"),
                    new Op("ADD", null, "종류가 틀림", "WRONG", null, null, 0, "r"),
                    new Op("RENAME", List.of(1L), "모르는 op", null, null, null, 0, "r"),
                    new Op(
                        "UPDATE", List.of(Long.MAX_VALUE), "입력 밖", "CONTEXT", null, null, 0, "r"),
                    new Op("ADD", null, "WP 프로젝트 배포 일을 맡고 있다", "CONTEXT", null, null, 0, "맡은 일"))));

    scheduler.runAllTenants();

    assertThat(memories(uid)).extracting(Row::content).containsExactly("WP 프로젝트 배포 일을 맡고 있다");
    assertThat(processed(sid)).isEqualTo(upto);
    assertThat(failures(sid)).isZero();
  }

  // 최종 리뷰 2: 결과 줄 「잊음」을 되돌려 되살린 메모리는 30분 뒤 같은 대화를 읽는 정리가 다시 지우지 못한다(프롬프트에도 「바꾸지 말 것」).
  @Test
  void 결과_줄에서_되돌린_잊음은_정리가_다시_지우지_못한다() {
    long uid = user();
    String marker = "잊음되돌림-" + uid;
    String content = "회의록은 영어로 쓴다";
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", "이제 " + content + " 이건 잊어줘 " + marker);
    AiMemoryItem m =
        memoryService.create(
            uid, new CreateAiMemoryRequest("PREFERENCE", content, "AI", null, null, null), true);
    memoryService.delete(uid, m.id(), true);
    long answer =
        answerWithBlock(
            uid,
            sid,
            AiMemoryTestFixtures.memoryBlock(
                "forgotten", m.id(), "PREFERENCE", content, null, "AI"));
    inTenant(() -> undoService.undo(uid, new UndoAiMemoryRequest(answer, 0)));
    idle(sid, Duration.ofDays(6));
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenReturn(
            new Result(
                List.of(new Op("FORGET", List.of(m.id()), null, null, null, null, 0, "부정함"))));
    ArgumentCaptor<Request> cap = ArgumentCaptor.forClass(Request.class);

    scheduler.runAllTenants();

    verify(client, atLeastOnce()).cleanup(cap.capture());
    Request req =
        cap.getAllValues().stream().filter(r -> carries(r, marker)).findFirst().orElseThrow();
    assertThat(req.memories())
        .filteredOn(r -> r.id() == m.id())
        .singleElement()
        .satisfies(r -> assertThat(r.undone()).isTrue());
    assertThat(memories(uid)).extracting(Row::id).containsExactly(m.id());
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  // 최종 리뷰 2: 결과 줄 「고침」을 되돌린 메모리는 정리가 같은 고침을 다시 하지 못하고, 거절한 내용은 지운 기록에 남는다.
  @Test
  void 결과_줄에서_되돌린_고침은_정리가_다시_고치지_못한다() {
    long uid = user();
    String marker = "고침되돌림-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    AiMemoryItem m =
        memoryService.create(
            uid, new CreateAiMemoryRequest("PREFERENCE", "아침 회의는 9시", "AI", sid, null, null), true);
    UpdateAiMemoryRequest edit = new UpdateAiMemoryRequest();
    edit.setContent("아침 회의는 10시");
    memoryService.update(uid, m.id(), edit, true);
    long answer =
        answerWithBlock(
            uid,
            sid,
            AiMemoryTestFixtures.memoryBlock(
                "updated", m.id(), "PREFERENCE", "아침 회의는 10시", "아침 회의는 9시", "AI"));
    inTenant(() -> undoService.undo(uid, new UndoAiMemoryRequest(answer, 0)));
    idle(sid, Duration.ofDays(6));
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenReturn(
            new Result(
                List.of(
                    new Op(
                        "UPDATE",
                        List.of(m.id()),
                        "아침 회의는 10시",
                        "PREFERENCE",
                        null,
                        null,
                        0,
                        "고침"))));

    scheduler.runAllTenants();

    assertThat(memories(uid)).extracting(Row::content).containsExactly("아침 회의는 9시");
    assertThat(inTenant(() -> AiMemoryTestFixtures.forgottenContents(baseDsl, uid)))
        .contains("아침 회의는 10시");
    assertThat(processed(sid)).isEqualTo(lastMessageId(sid));
  }

  // 최종 리뷰 5: 새 API + 구 ai-agent(경로 없음 404) 배포 구간 — 실패로 세면 3회 뒤 그 대화 정리를 영구히 잃는다. 장애처럼 세지 않는다.
  @Test
  void ai_agent_가_404_면_세지_않고_경계도_올리지_않는다() {
    long uid = user();
    String marker = "경로없음-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenThrow(
            new MemoryCleanupAiException(
                "경로 없음", new HttpClientErrorException(HttpStatus.NOT_FOUND)));

    scheduler.runAllTenants();
    scheduler.runAllTenants();
    scheduler.runAllTenants();

    assertThat(processed(sid)).isNull();
    assertThat(failures(sid)).isZero();
  }

  // 코드 리뷰 3: ai-agent 가 null op·이름 없는 op 을 보내도 결과 임베딩이 NPE 로 세션 전체를 실패로 세지 않는다 — 적용기처럼 그 op 만 버린다.
  @Test
  void null_op_과_이름_없는_op_은_버리고_나머지는_적용하며_경계가_오른다() {
    long uid = user();
    String marker = "널op-" + uid;
    UUID sid = conversation(uid, Duration.ofDays(6), "USER", LONG + marker);
    long upto = lastMessageId(sid);
    when(client.cleanup(argThat(r -> carries(r, marker))))
        .thenReturn(
            new Result(
                Arrays.asList(
                    null,
                    new Op(null, null, "이름 없는 op", "PREFERENCE", null, null, 0, "r"),
                    new Op("ADD", null, "WP 프로젝트 배포 일을 맡고 있다", "CONTEXT", null, null, 0, "맡은 일"))));

    scheduler.runAllTenants();

    assertThat(memories(uid)).extracting(Row::content).containsExactly("WP 프로젝트 배포 일을 맡고 있다");
    assertThat(processed(sid)).isEqualTo(upto);
    assertThat(failures(sid)).isZero();
  }

  // 코드 리뷰 4: 회차가 ShedLock 잠금 시간을 넘기지 않게 — 시작 뒤 25분이 지나면 새 세션을 시작하지 않고 다음 회차로 넘긴다(넘긴 세션은 실패로 세지
  // 않는다).
  @Test
  void 회차_시작_뒤_25분이_지나면_새_세션을_시작하지_않고_다음_회차로_넘긴다() {
    long uid = user();
    String slow = "느림-" + uid;
    String next = "다음-" + uid;
    UUID first = conversation(uid, Duration.ofDays(6).plusHours(1), "USER", LONG + slow);
    UUID second = conversation(uid, Duration.ofDays(6), "USER", LONG + next);
    MutableClock clock = new MutableClock(Instant.now());
    when(client.cleanup(argThat(r -> carries(r, slow))))
        .thenAnswer(
            inv -> {
              clock.advance(Duration.ofMinutes(26));
              return new Result(List.of());
            });

    scheduler.runAllTenants(clock);

    assertThat(processed(first)).isEqualTo(lastMessageId(first));
    verify(client, never()).cleanup(argThat(r -> carries(r, next)));
    assertThat(processed(second)).isNull();
    assertThat(failures(second)).isZero();
  }

  /** 테스트가 앞으로 돌리는 시계(UTC). */
  private static final class MutableClock extends Clock {
    private final AtomicReference<Instant> now;

    MutableClock(Instant start) {
      this.now = new AtomicReference<>(start);
    }

    void advance(Duration d) {
      now.updateAndGet(i -> i.plus(d));
    }

    @Override
    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
      return this;
    }

    @Override
    public Instant instant() {
      return now.get();
    }
  }
}
