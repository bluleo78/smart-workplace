package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.messaging.dto.ConversationSummaryItem;
import com.workplace.messaging.repository.ConversationAttentionRepository;
import com.workplace.messaging.service.MessagingSummaryService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * MessagingSummaryService AI 발굴 신호 통합 테스트 (#476).
 *
 * <p>인프로세스 @Transactional + BeforeEach GUC 주입으로 RLS 통과.
 * - AI 마크가 안읽음 대화에 aiReason 으로 실린다.
 * - 읽은 대화에는 aiReason 이 null.
 * - aiAttentionCount 는 여전히 안읽음인 AI 발굴 대화 수.
 * - 기계적 신호(mentioned/needsReply/needsReplyCount/unreadConversationCount) 불변.
 * - aiReason 있는 대화가 신호 없는 대화보다 정렬 우선.
 */
@Transactional
class MessagingSummaryServiceTest extends IntegrationTestBase {

  @Autowired MessagingSummaryService svc;
  @Autowired ConversationAttentionRepository attentionRepo;
  @Autowired DSLContext dsl;

  /** RLS 게이트: test DB 세션에 tenant_id=1 주입. */
  @BeforeEach
  void setTenant() {
    dsl.execute("set app.tenant_id='1'");
  }

  // ── 시드 헬퍼 ─────────────────────────────────────────────────────────────

  private long seedUser(String prefix) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix + s)
        .set(USER.EMAIL, prefix + "_" + s + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 퍼블릭 채널 생성 + 소유자를 CHANNEL_MEMBER 에 추가 후 채널 id 반환. */
  private long seedChannel(long ownerId) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 6);
    long ch =
        dsl.insertInto(CHANNEL)
            .set(CHANNEL.NAME, "test-ch-" + s)
            .set(CHANNEL.KIND, "CHANNEL")
            .set(CHANNEL.VISIBILITY, "PUBLIC")
            .set(CHANNEL.CREATED_BY, ownerId)
            .returning(CHANNEL.ID)
            .fetchOne()
            .getId();
    joinChannel(ownerId, ch);
    return ch;
  }

  private void joinChannel(long userId, long channelId) {
    dsl.insertInto(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.CHANNEL_ID, channelId)
        .set(CHANNEL_MEMBER.USER_ID, userId)
        .set(CHANNEL_MEMBER.ROLE, "MEMBER")
        .onConflict(CHANNEL_MEMBER.CHANNEL_ID, CHANNEL_MEMBER.USER_ID)
        .doNothing()
        .execute();
  }

  private long seedMessage(long channelId, long authorId, String body) {
    return dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, authorId)
        .set(MESSAGE.BODY, body)
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[]"))
        .returning(MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** caller 의 CHANNEL_MEMBER.last_read_message_id 를 messageId 로 설정(읽음 표시). */
  private void markRead(long callerId, long channelId, long messageId) {
    dsl.update(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, messageId)
        .where(
            CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
        .execute();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  /**
   * AI 마크가 안읽음 대화에 aiReason 으로 실린다.
   * 채널에 안읽음 메시지 시드 + AI 마크 upsert → recent 의 해당 item.aiReason() 이 non-null.
   */
  @Test
  void aiMark_안읽음_대화에_aiReason이_실린다() {
    long caller = seedUser("caller");
    long other = seedUser("other");
    long ch = seedChannel(caller);
    joinChannel(other, ch);

    // other 가 메시지 작성 → caller 에게 안읽음(watermark null).
    long msgId = seedMessage(ch, other, "동희 관련 내용");
    // AI 마크 upsert.
    attentionRepo.upsert(ch, caller, "동희 관련", msgId);

    var resp = svc.summary(caller, 10);

    ConversationSummaryItem item =
        resp.recent().stream().filter(i -> i.conversationId() == ch).findFirst().orElseThrow();
    assertThat(item.aiReason()).isEqualTo("동희 관련");
  }

  /**
   * 읽으면 aiReason null + aiAttentionCount 미포함.
   * 채널을 읽음 처리(last_read_message_id = 최신 메시지) 후 aiReason 이 null 이어야 한다.
   */
  @Test
  void 읽은대화_aiReason_null() {
    long caller = seedUser("readclear");
    long other = seedUser("other_rc");
    long ch = seedChannel(caller);
    joinChannel(other, ch);

    long msgId = seedMessage(ch, other, "읽은 내용");
    attentionRepo.upsert(ch, caller, "읽어서 제거", msgId);

    // 읽음 처리.
    markRead(caller, ch, msgId);

    var resp = svc.summary(caller, 10);

    // recent 에 해당 채널이 있으면 aiReason null; 없어도 aiAttentionCount=0 으로 충분.
    resp.recent().stream()
        .filter(i -> i.conversationId() == ch)
        .findFirst()
        .ifPresent(item -> assertThat(item.aiReason()).isNull());

    // aiAttentionCount 에도 미포함.
    assertThat(resp.aiAttentionCount()).isEqualTo(0L);
  }

  /**
   * aiAttentionCount = 안읽음 AI 마크 수.
   * AI 마크 2건: 채널 A(안읽음), 채널 B(읽음) → aiAttentionCount == 1.
   */
  @Test
  void aiAttentionCount_안읽음_AI_대화수() {
    long caller = seedUser("attcount");
    long other = seedUser("other_ac");
    long chA = seedChannel(caller);
    long chB = seedChannel(caller);
    joinChannel(other, chA);
    joinChannel(other, chB);

    // A: 안읽음.
    long mA = seedMessage(chA, other, "A 메시지");
    attentionRepo.upsert(chA, caller, "A 이유", mA);

    // B: 읽음.
    long mB = seedMessage(chB, other, "B 메시지");
    attentionRepo.upsert(chB, caller, "B 이유", mB);
    markRead(caller, chB, mB);

    var resp = svc.summary(caller, 10);
    assertThat(resp.aiAttentionCount()).isEqualTo(1L);
  }

  /**
   * 기계적 신호 불변 — mentioned/needsReply/needsReplyCount/unreadConversationCount 동작이 깨지지 않는다.
   * 멘션 대화가 있으면 mentioned=true + needsReplyCount>=1.
   */
  @Test
  void 기계적_신호_불변() {
    long caller = seedUser("mechsig");
    long other = seedUser("other_ms");
    long ch = seedChannel(caller);
    joinChannel(other, ch);

    // other 가 caller 를 멘션.
    dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, ch)
        .set(MESSAGE.AUTHOR_ID, other)
        .set(MESSAGE.BODY, "@mention")
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + caller + "]"))
        .returning(MESSAGE.ID)
        .fetchOne();

    var resp = svc.summary(caller, 10);

    assertThat(resp.unreadConversationCount()).isGreaterThanOrEqualTo(1L);
    assertThat(resp.needsReplyCount()).isGreaterThanOrEqualTo(1L);
    assertThat(resp.recent()).anyMatch(ConversationSummaryItem::mentioned);
  }

  /**
   * attentionCount dedup — 멘션 + AI 마크 둘 다인 채널이 합집합 카운트에 1로만 세진다(이중 집계 없음, #476 I2).
   * 같은 채널이 needsReply(멘션) 와 aiAttention(마크) 두 신호를 모두 가져도 attentionCount 는 1.
   */
  @Test
  void attentionCount_멘션과_AI마크_겹치는_채널은_1로만() {
    long caller = seedUser("dedup");
    long other = seedUser("other_dd");
    long ch = seedChannel(caller);
    joinChannel(other, ch);

    // 한 채널에서: other 가 caller 를 멘션(needsReply 신호) + 같은 채널에 AI 마크(aiAttention 신호).
    long msgId =
        dsl.insertInto(MESSAGE)
            .set(MESSAGE.CHANNEL_ID, ch)
            .set(MESSAGE.AUTHOR_ID, other)
            .set(MESSAGE.BODY, "@mention 동희 관련")
            .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + caller + "]"))
            .returning(MESSAGE.ID)
            .fetchOne()
            .getId();
    attentionRepo.upsert(ch, caller, "동희 관련", msgId);

    var resp = svc.summary(caller, 10);

    // 두 신호 모두 켜져 needsReplyCount>=1 && aiAttentionCount==1 이지만, 합집합 attentionCount 는 1.
    assertThat(resp.needsReplyCount()).isGreaterThanOrEqualTo(1L);
    assertThat(resp.aiAttentionCount()).isEqualTo(1L);
    assertThat(resp.attentionCount()).isEqualTo(1L); // 단순 합(>=2) 아닌 dedup=1
  }

  /**
   * 정렬 — aiReason 있는 대화가 신호 없는 일반 대화보다 앞에 온다.
   */
  @Test
  void 정렬_aiReason있는_대화가_우선() {
    long caller = seedUser("sorttest");
    long other = seedUser("other_st");

    // 채널 A: AI 마크 없음(일반).
    long chA = seedChannel(caller);
    joinChannel(other, chA);
    long mA = seedMessage(chA, other, "일반 메시지");

    // 채널 B: AI 마크 있음.
    long chB = seedChannel(caller);
    joinChannel(other, chB);
    long mB = seedMessage(chB, other, "AI 발굴 메시지");
    attentionRepo.upsert(chB, caller, "B 이유", mB);

    var resp = svc.summary(caller, 10);

    // chB(AI마크)가 chA(일반)보다 앞에 있어야 한다.
    int idxA = -1, idxB = -1;
    var list = resp.recent();
    for (int i = 0; i < list.size(); i++) {
      if (list.get(i).conversationId() == chA) idxA = i;
      if (list.get(i).conversationId() == chB) idxB = i;
    }
    assertThat(idxB).isGreaterThanOrEqualTo(0);
    assertThat(idxA).isGreaterThanOrEqualTo(0);
    assertThat(idxB).isLessThan(idxA);
  }
}
