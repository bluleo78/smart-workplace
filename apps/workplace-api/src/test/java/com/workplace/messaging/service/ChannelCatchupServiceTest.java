package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.ai.AiMemoryLine;
import com.workplace.global.ai.AiMemoryReader;
import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.ai.SharedMemories;
import com.workplace.global.ai.SharedMemoryLine;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.outbound.AiAgentCatchupClient;
import com.workplace.messaging.outbound.dto.CatchupSummarizeRequest;
import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.ExternalClientMockedTestBase;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * ChannelCatchupService 통합 테스트.
 *
 * <p>클래스 레벨 @Transactional 로 인프로세스 롤백(MessagingSummaryRepositoryTest 패턴). 시드·조회는 모두 기본 테넌트(GUC=1)
 * 아래에서 동작하므로 별도 GUC 주입 불필요. AiAgentCatchupClient 는 @MockitoBean 으로 대체해 AI 호출 경로(캐시·정직성·호출 횟수)를
 * 검증한다.
 *
 * <p>케이스: ①내 차례=나를 멘션한 미읽음만 ②환각 id 필터 ③미읽음0=AI 미호출+빈응답 ④캐시 히트=AI 1회 ⑤비멤버 403 ⑥타테넌트 채널=RLS
 * fail-closed 403 ⑦메모리 지문 캐시(WP-381 — 메모리가 같으면 함께 쓰고, 다르거나 바뀌면 다시 요약).
 */
@Transactional
class ChannelCatchupServiceTest extends ExternalClientMockedTestBase {

  @Autowired ChannelCatchupService service;
  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @Autowired AiAgentCatchupClient catchupClient;
  @Autowired AssistantResolver assistantResolver;

  /** 요청자 메모리(WP-381) — 공통 spy(IntegrationTestBase). 스텁하지 않으면 실제로 읽으며, 새 사용자는 메모리가 없어 빈 목록이다. */
  @Autowired AiMemoryReader memoryReader;

  /** 조직 공용 메모리(WP-386) — 공통 spy(IntegrationTestBase). 스텁하지 않으면 실제로 읽는다. */
  @Autowired SharedAiMemoryReader sharedReader;

  /** 해석될 비서 사양 — 하드코딩 id(2) 가 아닌 이 값이 AI 요청에 실려야 한다(WP-110). */
  private static final AssistantSpec SPEC =
      new AssistantSpec(777L, "test-model", "NORMAL", 8, 60_000);

  private long callerA;
  private long userB;
  private long userC;

  @BeforeEach
  void seedUsers() {
    callerA = seedUser("a");
    userB = seedUser("b");
    userC = seedUser("c");
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.of(SPEC));
  }

  /** 고유 사용자 시드 헬퍼. */
  private long seedUser(String prefix) {
    String s = UUID.randomUUID().toString().replaceAll("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix.toUpperCase() + "_" + s)
        .set(USER.EMAIL, prefix + "_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 채널 생성 + callerA·userB·userC 가입(3인 그룹 — 멘션 규칙 적용). 채널 id 반환. */
  private long seedChannelWithMembers() {
    long c = channelRepo.insertPublic("catchup-" + UUID.randomUUID(), userB);
    channelService.join(userB, c);
    channelService.join(callerA, c);
    channelService.join(userC, c);
    return c;
  }

  /** 2인 채널(callerA·userB) — 1:1 DM 규칙(상대 발화=내 차례) 검증용. */
  private long seedTwoMemberChannel() {
    long c = channelRepo.insertPublic("catchup-dm-" + UUID.randomUUID(), userB);
    channelService.join(userB, c);
    channelService.join(callerA, c);
    return c;
  }

  /** callerA 가 채널에 메시지 작성. 메시지 id 반환. */
  private long postByA(long channelId, String body) {
    return messageService.create(callerA, channelId, new CreateMessageRequest(body)).id();
  }

  /** userB 가 채널에 메시지 작성. mentionUserId 가 있으면 그 사람을 멘션. 메시지 id 반환. */
  private long postByB(long channelId, String body, Long mentionUserId) {
    long id = messageService.create(userB, channelId, new CreateMessageRequest(body)).id();
    if (mentionUserId != null) {
      dsl.update(MESSAGE)
          .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + mentionUserId + "]"))
          .where(MESSAGE.ID.eq(id))
          .execute();
    }
    return id;
  }

  @Test
  void 내차례는_나를_멘션한_미읽음만() {
    long channelId = seedChannelWithMembers();
    // m1: 멘션 없음, m2: callerA 멘션. watermark(since) = m1 직전.
    long m1 = postByB(channelId, "그냥 메시지", null);
    long m2 = postByB(channelId, "@A 확인 부탁", callerA);
    long since = m1 - 1;

    when(catchupClient.summarize(any()))
        .thenReturn(
            new CatchupSummarizeResult(
                List.of(), List.of(new CatchupSummarizeResult.Group("논의", List.of(m1, m2)))));

    var res = service.summarize(callerA, channelId, since);

    // 내 차례엔 m2 만(m1 제외).
    assertThat(res.yourTurn()).extracting("messageId").containsExactly(m2);
    assertThat(res.unreadCount()).isEqualTo(2);
    assertThat(res.summarizedCount()).isEqualTo(2);
  }

  /**
   * userB 가 count 건을 한 번에 저장한다(서비스 부수 효과 없이, 한 문장) — 마지막 mentionLast 건은 callerA 를 멘션. 저장한
   * id(오래된→최신).
   */
  private List<Long> bulkByB(long channelId, int count, int mentionLast) {
    var insert =
        dsl.insertInto(
            MESSAGE, MESSAGE.CHANNEL_ID, MESSAGE.AUTHOR_ID, MESSAGE.BODY, MESSAGE.MENTIONS);
    for (int i = 0; i < count; i++) {
      boolean mention = i >= count - mentionLast;
      insert =
          insert.values(
              channelId, userB, "메시지 " + i, JSONB.valueOf(mention ? "[" + callerA + "]" : "[]"));
    }
    return insert.returning(MESSAGE.ID).fetch(MESSAGE.ID).stream().sorted().toList();
  }

  /**
   * 내 차례 미리보기의 멘션 토큰은 @이름으로 바꿔 싣는다(WP-1188) — 웹은 미리보기를 글자 그대로 그려 원문 「<@id>」가 보였다. 모르는 id 는 「@사용자」.
   */
  @Test
  void 내차례_미리보기의_멘션은_이름으로() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "**<@" + callerA + ">** 이거 확인 부탁해요 <@999999999>", callerA);
    when(catchupClient.summarize(any()))
        .thenReturn(
            new CatchupSummarizeResult(
                List.of(), List.of(new CatchupSummarizeResult.Group("논의", List.of(m1)))));

    var res = service.summarize(callerA, channelId, m1 - 1);

    String nameA = dsl.select(USER.NAME).from(USER).where(USER.ID.eq(callerA)).fetchOne(USER.NAME);
    assertThat(res.yourTurn())
        .singleElement()
        .satisfies(m -> assertThat(m.snippet()).isEqualTo("@" + nameA + " 이거 확인 부탁해요 @사용자"));
  }

  /**
   * 미읽음이 요약 상한(200)을 넘으면 가장 최근 200건을 요약하고, 안 읽은 수는 실제 수, 맨 끝의 멘션은 내 차례에 나온다(WP-1183 — 오래된 200건만 보고
   * 최근 멘션이 빠졌다).
   */
  @Test
  void 상한을_넘는_미읽음은_최근_것을_요약하고_수와_최근_멘션을_잃지_않는다() {
    long channelId = seedChannelWithMembers();
    List<Long> ids = bulkByB(channelId, 210, 2);
    long since = ids.getFirst() - 1;
    ArgumentCaptor<CatchupSummarizeRequest> req =
        ArgumentCaptor.forClass(CatchupSummarizeRequest.class);
    when(catchupClient.summarize(req.capture()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    var res = service.summarize(callerA, channelId, since);

    assertThat(res.unreadCount()).isEqualTo(210);
    assertThat(res.summarizedCount()).isEqualTo(200);
    assertThat(res.yourTurn()).extracting("messageId").containsExactly(ids.get(208), ids.get(209));
    // 요약 입력은 가장 최근 200건(오래된→최신) — 처음 10건이 빠진다.
    assertThat(req.getValue().messages())
        .extracting("id")
        .containsExactlyElementsOf(ids.subList(10, 210));
  }

  /** 요약 상한 밖(오래된 쪽)의 멘션도 내 차례에 나온다 — 요약 창 안의 멘션과 함께, 오래된→최신 순. */
  @Test
  void 요약_상한_밖의_오래된_멘션도_내차례에_나온다() {
    long channelId = seedChannelWithMembers();
    long old = postByB(channelId, "@A 오래전 부탁", callerA);
    List<Long> ids = bulkByB(channelId, 205, 1);
    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    var res = service.summarize(callerA, channelId, old - 1);

    assertThat(res.unreadCount()).isEqualTo(206);
    assertThat(res.yourTurn()).extracting("messageId").containsExactly(old, ids.getLast());
  }

  /** 요약 창 안에 멘션이 멘션 상한(50)보다 많아도, 창보다 오래된 멘션은 내 차례에 나온다 — 창 안 멘션이 상한을 다 쓰지 않는다. */
  @Test
  void 요약_창_안_멘션이_많아도_창_밖_오래된_멘션이_빠지지_않는다() {
    long channelId = seedChannelWithMembers();
    long old = postByB(channelId, "@A 오래전 부탁", callerA);
    List<Long> ids = bulkByB(channelId, 205, 60);
    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    var res = service.summarize(callerA, channelId, old - 1);

    assertThat(res.yourTurn()).hasSize(61);
    assertThat(res.yourTurn().getFirst().messageId()).isEqualTo(old);
    assertThat(res.yourTurn().getLast().messageId()).isEqualTo(ids.getLast());
  }

  @Test
  void 환각_id는_근거에서_필터() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "출시 일정 6/30", null);
    long since = m1 - 1;

    // AI 가 입력에 없는 id(999) 를 근거로 반환 → 응답에서 제거되어야 한다.
    when(catchupClient.summarize(any()))
        .thenReturn(
            new CatchupSummarizeResult(
                List.of(new CatchupSummarizeResult.Group("결정", List.of(m1, 999L))), List.of()));

    var res = service.summarize(callerA, channelId, since);

    assertThat(res.decisions()).hasSize(1);
    assertThat(res.decisions().get(0).sourceMessageIds()).contains(m1).doesNotContain(999L);
  }

  @Test
  void 미읽음_0이면_AI_미호출_빈응답() {
    long channelId = seedChannelWithMembers();
    postByB(channelId, "이미 읽은 메시지", null);

    // since = Long.MAX_VALUE → 그 이후 메시지 0건.
    var res = service.summarize(callerA, channelId, Long.MAX_VALUE);

    assertThat(res.unreadCount()).isZero();
    assertThat(res.decisions()).isEmpty();
    assertThat(res.yourTurn()).isEmpty();
    assertThat(res.discussion()).isEmpty();
    verify(catchupClient, never()).summarize(any());
  }

  @Test
  void 캐시_히트_시_AI_1회만() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "캐시 테스트", null);
    long since = m1 - 1;

    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    // 같은 (channelId, since, maxId) → 두 번째 호출은 캐시 히트.
    service.summarize(callerA, channelId, since);
    service.summarize(callerA, channelId, since);

    verify(catchupClient, times(1)).summarize(any());
  }

  /** 같은 채널·같은 미읽음이어도 메모리가 다른 사용자는 캐시를 쓰지 않고 자기 메모리로 다시 요약한다(같은 사용자·같은 메모리는 캐시). */
  @Test
  void 같은_채널이어도_메모리가_다른_사용자는_자기_메모리로_다시_요약한다() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "배포 일정 공유합니다", null);
    long since = m1 - 1;
    doReturn(List.of(new AiMemoryLine(1L, "PREFERENCE", "요약은 세 줄로", "MESSAGING", null, null)))
        .when(memoryReader)
        .readForEntry(callerA, AiMemoryReader.MESSAGING, null);
    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    service.summarize(callerA, channelId, since);
    service.summarize(callerA, channelId, since);
    service.summarize(userC, channelId, since);

    ArgumentCaptor<CatchupSummarizeRequest> cap =
        ArgumentCaptor.forClass(CatchupSummarizeRequest.class);
    verify(catchupClient, times(2)).summarize(cap.capture());
    assertThat(cap.getAllValues().get(0).memories())
        .extracting(AiMemoryLine::content)
        .containsExactly("요약은 세 줄로");
    assertThat(cap.getAllValues().get(1).memories()).isEmpty();
    // 캐시 키가 메모리 지문이라 캐시 확인 전에 매번 메모리를 읽는다.
    verify(memoryReader, times(2)).readForEntry(callerA, AiMemoryReader.MESSAGING, null);
  }

  /** WP-386: 요약 요청에 조직 공용 메모리를 싣고, 공용 메모리가 바뀌면 캐시된 요약을 쓰지 않고 다시 만든다. */
  @Test
  void 공용_메모리를_싣고_바뀌면_다시_요약한다() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "배포 일정 공유합니다", null);
    long since = m1 - 1;
    var first = new SharedMemories(List.of(new SharedMemoryLine("조직", "결정은 굵게")), 1);
    var second = new SharedMemories(List.of(new SharedMemoryLine("조직", "결정은 표로")), 0);
    doReturn(first, first, second).when(sharedReader).readForUser(callerA, null, null);
    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    service.summarize(callerA, channelId, since);
    service.summarize(callerA, channelId, since); // 같은 공용 메모리 — 캐시 적중
    service.summarize(callerA, channelId, since); // 공용 메모리가 바뀜 — 다시 요약

    ArgumentCaptor<CatchupSummarizeRequest> cap =
        ArgumentCaptor.forClass(CatchupSummarizeRequest.class);
    verify(catchupClient, times(2)).summarize(cap.capture());
    assertThat(cap.getAllValues().get(0).sharedMemories()).isEqualTo(first.items());
    assertThat(cap.getAllValues().get(0).sharedMemoryMoreCount()).isEqualTo(1);
    assertThat(cap.getAllValues().get(1).sharedMemories()).isEqualTo(second.items());
  }

  /** 메모리가 없는 사용자끼리는 같은 채널·같은 미읽음 요약을 함께 쓴다 — 요약에 개인 메모리가 실리지 않았으니 나눠 써도 된다. */
  @Test
  void 메모리가_없는_두_사용자는_요약을_함께_쓴다() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "회의록 올렸어요", null);
    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    service.summarize(callerA, channelId, m1 - 1);
    service.summarize(userC, channelId, m1 - 1);

    verify(catchupClient, times(1)).summarize(any());
  }

  /** 메모리 내용이 다르면 같은 채널·같은 미읽음이어도 다른 사람의 메모리로 만든 요약을 쓰지 않는다. */
  @Test
  void 메모리가_다른_두_사용자는_요약을_나눠_쓰지_않는다() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "회의록 올렸어요", null);
    doReturn(List.of(new AiMemoryLine(1L, "PREFERENCE", "요약은 세 줄로", null, null, null)))
        .when(memoryReader)
        .readForEntry(callerA, AiMemoryReader.MESSAGING, null);
    doReturn(List.of(new AiMemoryLine(2L, "PREFERENCE", "요약은 표로", null, null, null)))
        .when(memoryReader)
        .readForEntry(userC, AiMemoryReader.MESSAGING, null);
    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    service.summarize(callerA, channelId, m1 - 1);
    service.summarize(userC, channelId, m1 - 1);

    ArgumentCaptor<CatchupSummarizeRequest> cap =
        ArgumentCaptor.forClass(CatchupSummarizeRequest.class);
    verify(catchupClient, times(2)).summarize(cap.capture());
    assertThat(cap.getAllValues())
        .extracting(r -> r.memories().get(0).content())
        .containsExactly("요약은 세 줄로", "요약은 표로");
  }

  /** 메모리를 고치면 같은 사용자·같은 미읽음이어도 캐시를 쓰지 않고 바뀐 메모리로 다시 요약한다. */
  @Test
  void 메모리가_바뀌면_캐시를_쓰지_않고_다시_요약한다() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "배포 일정 공유합니다", null);
    doReturn(List.of(new AiMemoryLine(1L, "PREFERENCE", "요약은 세 줄로", null, null, null)))
        .when(memoryReader)
        .readForEntry(callerA, AiMemoryReader.MESSAGING, null);
    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));
    service.summarize(callerA, channelId, m1 - 1);

    doReturn(List.of(new AiMemoryLine(1L, "PREFERENCE", "요약은 다섯 줄로", null, null, null)))
        .when(memoryReader)
        .readForEntry(callerA, AiMemoryReader.MESSAGING, null);
    service.summarize(callerA, channelId, m1 - 1);

    ArgumentCaptor<CatchupSummarizeRequest> cap =
        ArgumentCaptor.forClass(CatchupSummarizeRequest.class);
    verify(catchupClient, times(2)).summarize(cap.capture());
    assertThat(cap.getAllValues().get(1).memories())
        .extracting(AiMemoryLine::content)
        .containsExactly("요약은 다섯 줄로");
  }

  @Test
  void 비멤버는_403() {
    long channelId = seedChannelWithMembers();
    postByB(channelId, "메시지", null);
    long stranger = seedUser("stranger");

    assertThatThrownBy(() -> service.summarize(stranger, channelId, 0))
        .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void 타테넌트_채널은_RLS로_403() {
    // 두 번째 테넌트 아래에서 채널·멤버·메시지를 시드(tx-local GUC=tid2)한 뒤 GUC=1 로 복귀.
    long tid2 = ensureSecondTenant();
    setTxGuc(tid2);
    long foreignChannel =
        dsl.insertInto(CHANNEL)
            .set(CHANNEL.NAME, "foreign-" + UUID.randomUUID())
            .set(CHANNEL.KIND, "CHANNEL")
            .set(CHANNEL.VISIBILITY, "PUBLIC")
            .set(CHANNEL.CREATED_BY, userB)
            .returning(CHANNEL.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.CHANNEL_ID, foreignChannel)
        .set(CHANNEL_MEMBER.USER_ID, callerA)
        .set(CHANNEL_MEMBER.ROLE, "MEMBER")
        .execute();
    dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, foreignChannel)
        .set(MESSAGE.AUTHOR_ID, userB)
        .set(MESSAGE.BODY, "타테넌트 메시지")
        .execute();

    // 기본 테넌트(GUC=1)로 복귀 — 이제 foreignChannel 의 멤버 행은 RLS 로 보이지 않음.
    setTxGuc(1L);

    // isMember 가 RLS fail-closed(0행) → 비멤버 취급 → 403.
    assertThatThrownBy(() -> service.summarize(callerA, foreignChannel, 0))
        .isInstanceOf(ResponseStatusException.class);
  }

  @Test
  void 이인대화는_상대_발화_전부가_내차례() {
    long channelId = seedTwoMemberChannel();
    long m1 = postByB(channelId, "안녕 확인 좀", null);
    long m2 = postByB(channelId, "이것도 봐줘", null);
    long since = m1 - 1;

    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    var res = service.summarize(callerA, channelId, since);

    // 멘션이 없어도 2인 대화이므로 상대(userB) 발화 전부가 내 차례.
    assertThat(res.yourTurn()).extracting("messageId").containsExactly(m1, m2);
  }

  @Test
  void 이인대화에서_내가_보낸건_내차례_아님() {
    long channelId = seedTwoMemberChannel();
    long mB = postByB(channelId, "상대 발화", null);
    long mA = postByA(channelId, "내 발화");
    long since = mB - 1;

    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    var res = service.summarize(callerA, channelId, since);

    // 내가 보낸 mA 는 제외, 상대 mB 만.
    assertThat(res.yourTurn()).extracting("messageId").containsExactly(mB);
  }

  @Test
  void AI_요청은_caller_기준으로_해석한_비서로_보낸다() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "요약해줘", null);

    when(catchupClient.summarize(any()))
        .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

    service.summarize(callerA, channelId, m1 - 1);

    // 하드코딩 id(2)가 아니라 caller 의 비서(개인 → 공용)가 실려야 한다 — 운영에서 id 2 는 HUMAN 이라 400 이었다.
    verify(assistantResolver).resolveOrEmpty(callerA);
    ArgumentCaptor<CatchupSummarizeRequest> req =
        ArgumentCaptor.forClass(CatchupSummarizeRequest.class);
    verify(catchupClient).summarize(req.capture());
    assertThat(req.getValue().assistantAgentId()).isEqualTo(777L);
    assertThat(req.getValue().model()).isEqualTo("test-model");
  }

  @Test
  void 비서가_없으면_AI_없이_내차례만_돌려준다() {
    long channelId = seedChannelWithMembers();
    long m1 = postByB(channelId, "@A 확인 부탁", callerA);
    when(assistantResolver.resolveOrEmpty(anyLong())).thenReturn(Optional.empty());

    var res = service.summarize(callerA, channelId, m1 - 1);

    // AI 요약은 비고, 결정론적 "내 차례"·미읽음 수는 그대로.
    verify(catchupClient, never()).summarize(any());
    assertThat(res.unreadCount()).isEqualTo(1);
    assertThat(res.yourTurn()).extracting("messageId").containsExactly(m1);
    assertThat(res.decisions()).isEmpty();
    assertThat(res.discussion()).isEmpty();
  }

  /** 트랜잭션-로컬 GUC 설정(true = 현재 tx 안에서만 유효, 롤백 시 사라짐). */
  private void setTxGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 두 번째 테넌트 조회 또는 생성. */
  private long ensureSecondTenant() {
    String slug = "catchup-tenant-2";
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(slug)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, slug)
        .set(TENANT.NAME, "Catchup Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * WP-381: 메모리는 읽기 트랜잭션 밖에서 읽는다 — 안에서 읽으면 요청 하나가 커넥션 두 개를 동시에 쥐어, 풀이 포화되면 요청끼리 서로를 기다린다. 테스트 트랜잭션이
   * 있으면 늘 "트랜잭션 중"으로 보이므로 이 테스트만 트랜잭션 없이 돌린다. 시드는 서비스 부수 효과(알림 등)가 없도록 jOOQ 로 직접 커밋하고 끝에 지운다.
   * 멤버십·미읽음 조회가 서비스 자체 읽기 트랜잭션(RLS GUC)에서 그대로 통과하는지도 함께 본다.
   */
  @Test
  @Transactional(propagation = Propagation.NOT_SUPPORTED)
  void 메모리는_트랜잭션_밖에서_읽는다() {
    TenantContext.set(1L);
    long[] ids =
        new TransactionTemplate(txManager)
            .execute(
                s -> {
                  long c =
                      dsl.insertInto(CHANNEL)
                          .set(CHANNEL.NAME, "catchup-notx-" + UUID.randomUUID())
                          .set(CHANNEL.KIND, "CHANNEL")
                          .set(CHANNEL.VISIBILITY, "PUBLIC")
                          .set(CHANNEL.CREATED_BY, userB)
                          .returning(CHANNEL.ID)
                          .fetchOne()
                          .getId();
                  for (long u : new long[] {callerA, userB}) {
                    dsl.insertInto(CHANNEL_MEMBER)
                        .set(CHANNEL_MEMBER.CHANNEL_ID, c)
                        .set(CHANNEL_MEMBER.USER_ID, u)
                        .set(CHANNEL_MEMBER.ROLE, "MEMBER")
                        .execute();
                  }
                  long m =
                      dsl.insertInto(MESSAGE)
                          .set(MESSAGE.CHANNEL_ID, c)
                          .set(MESSAGE.AUTHOR_ID, userB)
                          .set(MESSAGE.BODY, "배포 일정 공유합니다")
                          .returning(MESSAGE.ID)
                          .fetchOne()
                          .getId();
                  return new long[] {c, m};
                });
    try {
      AtomicReference<Boolean> txActiveAtRead = new AtomicReference<>();
      doAnswer(
              inv -> {
                txActiveAtRead.set(TransactionSynchronizationManager.isActualTransactionActive());
                return List.of(
                    new AiMemoryLine(1L, "PREFERENCE", "요약은 세 줄로", "MESSAGING", null, null));
              })
          .when(memoryReader)
          .readForEntry(callerA, AiMemoryReader.MESSAGING, null);
      when(catchupClient.summarize(any()))
          .thenReturn(new CatchupSummarizeResult(List.of(), List.of()));

      var res = service.summarize(callerA, ids[0], ids[1] - 1);

      assertThat(txActiveAtRead.get()).isFalse();
      assertThat(res.unreadCount()).isEqualTo(1);
      ArgumentCaptor<CatchupSummarizeRequest> cap =
          ArgumentCaptor.forClass(CatchupSummarizeRequest.class);
      verify(catchupClient).summarize(cap.capture());
      assertThat(cap.getValue().memories())
          .extracting(AiMemoryLine::content)
          .containsExactly("요약은 세 줄로");
    } finally {
      cleanupInTenant(
          1L,
          () -> {
            baseDsl.deleteFrom(MESSAGE).where(MESSAGE.CHANNEL_ID.eq(ids[0])).execute();
            baseDsl
                .deleteFrom(CHANNEL_MEMBER)
                .where(CHANNEL_MEMBER.CHANNEL_ID.eq(ids[0]))
                .execute();
            baseDsl.deleteFrom(CHANNEL).where(CHANNEL.ID.eq(ids[0])).execute();
          });
      baseDsl.deleteFrom(USER).where(USER.ID.in(callerA, userB, userC)).execute();
      TenantContext.clear();
    }
  }
}
