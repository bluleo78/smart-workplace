package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.messaging.dto.CreateMessageRequest;
import com.workplace.messaging.outbound.AiAgentCatchupClient;
import com.workplace.messaging.outbound.dto.CatchupSummarizeResult;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * ChannelCatchupService 통합 테스트.
 *
 * <p>클래스 레벨 @Transactional 로 인프로세스 롤백(MessagingSummaryRepositoryTest 패턴). 시드·조회는 모두 기본 테넌트(GUC=1)
 * 아래에서 동작하므로 별도 GUC 주입 불필요. AiAgentCatchupClient 는 @MockBean 으로 대체해 AI 호출 경로(캐시·정직성·호출 횟수)를 검증한다.
 *
 * <p>케이스: ①내 차례=나를 멘션한 미읽음만 ②환각 id 필터 ③미읽음0=AI 미호출+빈응답 ④캐시 히트=AI 1회 ⑤비멤버 403 ⑥타테넌트 채널=RLS
 * fail-closed 403.
 */
@Transactional
class ChannelCatchupServiceTest extends IntegrationTestBase {

  @Autowired ChannelCatchupService service;
  @Autowired DSLContext dsl;
  @Autowired ChannelRepository channelRepo;
  @Autowired ChannelService channelService;
  @Autowired MessageService messageService;
  @MockBean AiAgentCatchupClient catchupClient;

  private long callerA;
  private long userB;
  private long userC;

  @BeforeEach
  void seedUsers() {
    callerA = seedUser("a");
    userB = seedUser("b");
    userC = seedUser("c");
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
}
