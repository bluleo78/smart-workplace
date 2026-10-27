package com.workplace.home.service;

import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_SESSION;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.SHARED_AI_MEMORY;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.SharedMemoryFixtures;
import com.workplace.home.dto.HomeChatRequest;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.AiAgentSuggestionClient;
import com.workplace.home.outbound.ChatMessages.ChatRequest;
import com.workplace.home.repository.HomeMessageRepository;
import com.workplace.home.repository.SharedAiMemoryRepository;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.service.AiPreferenceService;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * WP-386 스펙 5.1·6.1 홈 채팅 — 화면 공간은 서버가 확인한 것만 사용자 메시지에 남기고, 조직 + 그 공간 공용 메모리와 지금 공간을 ai-agent 로 싣는다.
 * 위조·권한 없음은 조직만, 메모리 꺼짐에도 싣는다, 구성원에서 빠지면 다음 턴부터 싣지 않는다. 펌프 스레드가 커밋하므로 @Transactional 을 쓰지 않는다
 * (HomeChatServiceTest 와 같은 방식) — 프로젝트 키는 무작위로 만들어 다른 테스트와 겹치지 않게 하고, 커밋한 데이터는 @AfterEach 가 테넌트
 * 트랜잭션으로 치운다. 조직 범위는 테넌트 공유라 이 테스트가 넣은 줄의 유무만 단언한다.
 */
@TestPropertySource(properties = "workplace.ai-agent.enabled=true")
class HomeChatSharedMemoryTest extends IntegrationTestBase {

  private static final String RULE = "배포는 API 먼저 한다";

  @Autowired HomeChatService chatService;
  @Autowired DSLContext dsl;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMembers;
  @Autowired SharedAiMemoryRepository repo;
  @Autowired HomeMessageRepository messages;
  @Autowired AiPreferenceService preferences;
  @MockitoBean AiAgentChatClient chatClient;
  @MockitoBean AiAgentSuggestionClient suggestionClient;
  @MockitoBean AssistantResolver assistantResolver;
  @MockitoBean SseRegistry sseRegistry;

  /** 기동 직후 스케줄러가 비서 스텁과 엇갈려 Mockito 상태를 오염시키지 않게(HomeChatServiceTest 와 같은 이유). */
  @MockitoBean TenantScopedRunner tenantScopedRunner;

  long owner;
  long member;
  long projectId;
  String key;

  /** 이 테스트가 만든 사용자 — 정리 대상(세션·메시지는 사용자 삭제 CASCADE). */
  final List<Long> users = new ArrayList<>();

  /** 테넌트 1 쓰기 트랜잭션(커밋). */
  private <T> T inTx(Supplier<T> body) {
    TenantContext.set(1L);
    return new TransactionTemplate(txManager).execute(s -> body.get());
  }

  private long newUser() {
    long id = inTx(() -> SharedMemoryFixtures.user(dsl));
    users.add(id);
    return id;
  }

  @BeforeEach
  void seed() {
    when(assistantResolver.resolve(anyLong()))
        .thenReturn(new AssistantSpec(5L, "claude-sonnet-4-6", "NORMAL", 8, 60000));
    // 프로젝트 키는 영문 대문자만 받는다. UUID 에서 영문자만 골라 자르면 영문자가 5개 미만인 UUID 에서
    // 깨지므로(드물게, 부하와 무관하게 실패), 무작위 대문자 5개를 직접 만든다.
    key =
        "H"
            + ThreadLocalRandom.current()
                .ints(5, 'A', 'Z' + 1)
                .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append);
    owner = newUser();
    member = newUser();
    projectId = inTx(() -> SharedMemoryFixtures.project(projectService, owner, key, "TEAM").id());
    inTx(
        () -> {
          SharedMemoryFixtures.addProjectMember(projectMembers, projectId, member);
          OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
          repo.insert(SpaceKey.of("PROJECT", projectId), RULE, "USER_ADDED", owner, owner, now);
          return null;
        });
  }

  /** 커밋한 공용 메모리·프로젝트·사용자(세션·메시지·환경설정은 CASCADE)를 테넌트 트랜잭션으로 지운다. */
  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(SHARED_AI_MEMORY)
              .where(SHARED_AI_MEMORY.SPACE_TYPE.eq("PROJECT"))
              .and(SHARED_AI_MEMORY.SPACE_ID.eq(projectId))
              .execute();
          dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
    users.clear();
    TenantContext.clear();
  }

  /** 한 턴을 보내고 ai-agent 로 나간 요청을 돌려준다. */
  private ChatRequest send(long uid, HomeChatRequest.Space space) throws Exception {
    CountDownLatch done = new CountDownLatch(1);
    doAnswer(
            inv -> {
              BiConsumer<String, JsonNode> onDone = inv.getArgument(2);
              onDone.accept("네", null);
              done.countDown();
              return null;
            })
        .when(chatClient)
        .composeStream(any(), any(), any(), any(), any(), any(), any());
    TenantContext.set(1L);
    chatService.startChat(uid, null, "배포 체크리스트 만들어줘", null, List.of(), null, "ISSUE", space);
    assertThat(done.await(5, TimeUnit.SECONDS)).isTrue();
    ArgumentCaptor<ChatRequest> cap = ArgumentCaptor.forClass(ChatRequest.class);
    verify(chatClient, atLeastOnce())
        .composeStream(cap.capture(), any(), any(), any(), any(), any(), any());
    clearInvocations(chatClient);
    return cap.getValue();
  }

  /** 그 사용자의 마지막 USER 메시지 공간(없으면 「-」). */
  private String lastUserSpace(long uid) {
    return inTx(
        () ->
            dsl.fetchOne(
                    "select coalesce(m.space_type || ':' || m.space_id, '-') from home_message m"
                        + " join home_session s on s.id = m.session_id where s.user_id = ? and m.role = 'USER'"
                        + " order by m.id desc limit 1",
                    uid)
                .get(0, String.class));
  }

  @Test
  void 확인된_화면_공간은_메시지에_남고_조직과_공간_메모리와_지금_공간을_싣는다() throws Exception {
    ChatRequest sent = send(member, new HomeChatRequest.Space("PROJECT", key, null));
    assertThat(sent.sharedMemories()).extracting(SharedMemoryLine::content).contains(RULE);
    assertThat(sent.currentSpace()).isNotNull();
    assertThat(sent.currentSpace().type()).isEqualTo("PROJECT");
    assertThat(sent.currentSpace().name()).isEqualTo(key + " 프로젝트(" + key + ")");
    assertThat(lastUserSpace(member)).isEqualTo("PROJECT:" + projectId);
  }

  /** 남긴 공간을 메시지 id·대화 단위로 다시 읽을 수 있다 — 배경 추출(발화별)·공용 요청 도구(마지막 발화)가 쓰는 조회. */
  @Test
  void 남긴_메시지_공간을_메시지_id와_대화로_다시_읽는다() throws Exception {
    send(member, new HomeChatRequest.Space("PROJECT", key, null));
    var row =
        inTx(
            () ->
                dsl.select(HOME_MESSAGE.ID, HOME_MESSAGE.SESSION_ID)
                    .from(HOME_MESSAGE)
                    .join(HOME_SESSION)
                    .on(HOME_SESSION.ID.eq(HOME_MESSAGE.SESSION_ID))
                    .where(HOME_SESSION.USER_ID.eq(member))
                    .and(HOME_MESSAGE.ROLE.eq("USER"))
                    .fetchOne());
    var expected = SpaceKey.of("PROJECT", projectId);
    assertThat(inTx(() -> messages.spacesOf(List.of(row.value1()))))
        .containsExactly(java.util.Map.entry(row.value1(), expected));
    assertThat(inTx(() -> messages.latestUserSpace(row.value2()))).contains(expected);
  }

  @Test
  void 못_읽는_프로젝트_키는_무시하고_조직만_싣는다() throws Exception {
    long outsider = newUser();
    ChatRequest sent = send(outsider, new HomeChatRequest.Space("PROJECT", key, null));
    assertThat(sent.sharedMemories()).extracting(SharedMemoryLine::content).doesNotContain(RULE);
    assertThat(sent.currentSpace()).isNull();
    assertThat(lastUserSpace(outsider)).isEqualTo("-");
  }

  @Test
  void 메모리를_꺼도_공용_메모리는_싣는다() throws Exception {
    inTx(
        () -> {
          preferences.update(member, null, false);
          return null;
        });
    ChatRequest sent = send(member, new HomeChatRequest.Space("PROJECT", key, null));
    assertThat(sent.memoryEnabled()).isFalse();
    assertThat(sent.sharedMemories()).extracting(SharedMemoryLine::content).contains(RULE);
  }

  @Test
  void 구성원에서_빠지면_다음_턴부터_싣지_않는다() throws Exception {
    assertThat(send(member, new HomeChatRequest.Space("PROJECT", key, null)).sharedMemories())
        .extracting(SharedMemoryLine::content)
        .contains(RULE);
    inTx(
        () -> {
          projectMembers.delete(projectId, member);
          return null;
        });
    ChatRequest next = send(member, new HomeChatRequest.Space("PROJECT", key, null));
    assertThat(next.sharedMemories()).extracting(SharedMemoryLine::content).doesNotContain(RULE);
    assertThat(next.currentSpace()).isNull();
  }
}
