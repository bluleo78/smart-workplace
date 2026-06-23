package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ConversationSummaryItem;
import com.workplace.messaging.dto.MessagingSummaryResponse;
import com.workplace.messaging.service.MessagingSummaryService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * RLS 회귀 가드 — {@link MessagingSummaryService#summary} 가 트랜잭션 경계 안에서 GUC(app.tenant_id)를 주입함을 증명.
 *
 * <p>{@link com.workplace.mail.MailSummaryServiceTenantTest} 와 동일한 패턴. 시드를 tid2 에 두고 세션 GUC 를 1 로
 * 되돌린 뒤 TenantContext=tid2 로 summary 호출. service 가 @Transactional 에서 GUC 를 주입하지 않으면 tid2 데이터는 RLS
 * fail-closed(0건) → 검증 실패.
 *
 * <p><b>@Transactional 절대 금지</b> — 외부 tx 가 service REQUIRED 에 합류하면 doBegin 미발화 → 검증 무력화. 시드는 반드시
 * raw DSL(set_config 세션 GUC 아래). channelService/messageService 사용 금지(자체 tx 에서 TenantContext=1). 커밋된
 * 시드는 @AfterEach 에서 자기-id 스코프(GUC=tid2)로 삭제.
 */
class MessagingSummaryServiceTenantTest extends IntegrationTestBase {

  private static final String TENANT2_SLUG = "msg-summary-tenant-2";

  @Autowired DSLContext dsl;
  @Autowired MessagingSummaryService messagingSummaryService;

  private Long channelId;
  private Long user2;
  private Long other2;
  private long tid2;

  /** 세션 GUC 설정(false = 트랜잭션 끝나도 유지). */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  /** 두 번째 테넌트 조회 또는 생성. */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(TENANT2_SLUG)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TENANT2_SLUG)
        .set(TENANT.NAME, "Messaging Summary Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 사용자 시드(USER 는 tenant_id 없는 전역 테이블). */
  private long seedUser(String prefix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix.toUpperCase() + "_" + t)
        .set(USER.EMAIL, prefix + "_" + t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @AfterEach
  void cleanup() {
    // 채널 삭제(CASCADE → channel_member, message).
    if (channelId != null) {
      setSessionGuc(tid2);
      dsl.deleteFrom(CHANNEL).where(CHANNEL.ID.eq(channelId)).execute();
    }
    // 사용자 삭제(전역 테이블).
    if (user2 != null) dsl.deleteFrom(USER).where(USER.ID.eq(user2)).execute();
    if (other2 != null) dsl.deleteFrom(USER).where(USER.ID.eq(other2)).execute();
    setSessionGuc(1L);
    TenantContext.clear();
  }

  @Test
  void summary_injectsTenantGuc_andCountsUnreadUnderNonDefaultTenant() {
    tid2 = ensureSecondTenant();

    // --- tenant2 세션 아래 데이터 시드 ---
    setSessionGuc(tid2);

    user2 = seedUser("u2");
    other2 = seedUser("other2");

    // 채널 생성(GUC=tid2 → tenant_id DEFAULT = tid2).
    channelId =
        dsl.insertInto(CHANNEL)
            .set(CHANNEL.NAME, "msg-sum-" + UUID.randomUUID().toString().substring(0, 8))
            .set(CHANNEL.KIND, "CHANNEL")
            .set(CHANNEL.VISIBILITY, "PUBLIC")
            .set(CHANNEL.CREATED_BY, other2)
            .returning(CHANNEL.ID)
            .fetchOne()
            .getId();

    // 두 사람 채널 가입(GUC=tid2 → tenant_id DEFAULT = tid2).
    dsl.insertInto(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.CHANNEL_ID, channelId)
        .set(CHANNEL_MEMBER.USER_ID, user2)
        .set(CHANNEL_MEMBER.ROLE, "MEMBER")
        .execute();
    dsl.insertInto(CHANNEL_MEMBER)
        .set(CHANNEL_MEMBER.CHANNEL_ID, channelId)
        .set(CHANNEL_MEMBER.USER_ID, other2)
        .set(CHANNEL_MEMBER.ROLE, "MEMBER")
        .execute();

    // other2 가 user2 를 멘션한 메시지(watermark NULL → unread).
    dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, other2)
        .set(MESSAGE.BODY, "안녕하세요 @u2")
        .set(MESSAGE.MENTIONS, JSONB.valueOf("[" + user2 + "]"))
        .execute();

    // --- 세션 GUC 를 기본(1)으로 되돌림 ---
    // 이제 summary 가 자체 tx 에서 GUC=tid2 를 주입하지 않으면 RLS fail-closed(0건) → 버그 재현.
    setSessionGuc(1L);

    // --- TenantContext=tid2 로 summary 호출 ---
    TenantContext.set(tid2);
    MessagingSummaryResponse res = messagingSummaryService.summary(user2, 5);

    // 검증: 안읽음 대화 ≥1, recent 비어있지 않음, 멘션 신호 포함.
    assertThat(res.unreadConversationCount()).isGreaterThanOrEqualTo(1);
    assertThat(res.recent()).isNotEmpty();
    assertThat(res.recent()).anyMatch(ConversationSummaryItem::mentioned);
  }
}
