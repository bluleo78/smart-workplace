package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** DM find-or-create·검증 통합 테스트(실제 DB). */
@Transactional
class DmServiceTest extends IntegrationTestBase {

  @Autowired DmService dmService;
  @Autowired DSLContext dsl;
  @Autowired ChannelMemberService memberService;
  @Autowired com.workplace.messaging.repository.ChannelMemberRepository memberRepo;
  @Autowired ChannelService channelService;
  @Autowired MockMvc mvc;
  @Autowired JwtTokenProvider jwt;

  /** 각 테스트 전 TenantContext 를 tenant#1 로 설정 — 멤버십 검증 통과를 위한 전제 조건. */
  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  /** 각 테스트 후 TenantContext 정리 — ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  /**
   * 고유 username/email 로 user 1행 insert 후 id 반환 — 공유 test DB(롤백 없음) 충돌 회피. tenant#1 ACTIVE 멤버십도 함께
   * 삽입하여 DM 생성 시 테넌트 경계 검증을 통과시킨다.
   */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ds_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Ds" + s)
            .set(USER.EMAIL, "ds_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // tenant#1 ACTIVE 멤버십 부여 — DM 생성 테넌트 경계 검증 통과용.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void createOrGet_oneToOne_isDeduped() {
    long a = seedUser();
    long b = seedUser();

    var first = dmService.createOrGet(a, List.of(b));
    var again = dmService.createOrGet(a, List.of(b));
    var reversed = dmService.createOrGet(b, List.of(a)); // 순서 무관

    assertThat(first.created()).isTrue();
    assertThat(again.created()).isFalse();
    assertThat(again.dm().id()).isEqualTo(first.dm().id());
    assertThat(reversed.dm().id()).isEqualTo(first.dm().id());
  }

  @Test
  void createOrGet_group_dedupBySet() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();

    var g1 = dmService.createOrGet(a, List.of(b, c));
    var g1again = dmService.createOrGet(a, List.of(c, b)); // 같은 셋
    var g2 = dmService.createOrGet(a, List.of(b)); // 다른 셋

    assertThat(g1again.dm().id()).isEqualTo(g1.dm().id());
    assertThat(g2.dm().id()).isNotEqualTo(g1.dm().id());
  }

  @Test
  void createOrGet_rejectsInvalid() {
    long a = seedUser();
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of()))
        .isInstanceOf(InvalidDmRequestException.class);
    assertThatThrownBy(() -> dmService.createOrGet(a, List.of(999_999_999L))) // 미존재
        .isInstanceOf(InvalidDmRequestException.class);
  }

  /** self-DM(본인만) 은 생성·dedup 되어야 한다(개인 메모 공간). */
  @Test
  void createOrGet_selfDm_createsAndDedups() {
    long a = seedUser();

    var first = dmService.createOrGet(a, List.of(a)); // 본인 id 를 타겟으로
    var again = dmService.createOrGet(a, List.of(a));

    assertThat(first.created()).isTrue();
    assertThat(again.created()).isFalse();
    assertThat(again.dm().id()).isEqualTo(first.dm().id());
    assertThat(first.dm().participants()).hasSize(1);
    assertThat(first.dm().participants().get(0).userId()).isEqualTo(a);
  }

  @Test
  void createOrGet_rejectsOverEight() {
    long a = seedUser();
    List<Long> targets =
        java.util.stream.IntStream.range(0, 8) // 본인+8 = 9 > 8
            .mapToObj(i -> seedUser())
            .toList();
    assertThatThrownBy(() -> dmService.createOrGet(a, targets))
        .isInstanceOf(InvalidDmRequestException.class);
  }

  @Test
  void listMyDms_returnsOnlyMine() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    dmService.createOrGet(a, List.of(b));
    dmService.createOrGet(b, List.of(c)); // a 무관 DM

    assertThat(dmService.listMyDms(a)).hasSize(1);
  }

  /** 타 테넌트(tenant#2) 전용 멤버를 DM 대상으로 지정하면 거부되어야 한다. 테넌트 경계를 넘는 DM 생성을 서비스 계층에서 차단함을 검증한다(설계 §4). */
  @Test
  void createOrGet_rejectsCrossTenantTarget() {
    long callerInTenant1 = seedUser(); // tenant#1 멤버

    // tenant#2 생성 + userB 는 tenant#2 에만 소속
    String slug = "test-dm-t2-" + UUID.randomUUID().toString().substring(0, 8);
    long tenant2Id =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "DM Cross Tenant Test")
            .set(TENANT.SLUG, slug)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long userBInTenant2Only =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "dm_t2_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "DmT2" + s)
            .set(USER.EMAIL, "dm_t2_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // tenant#2 에만 ACTIVE 멤버십 부여(tenant#1 멤버십 없음).
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userBInTenant2Only)
        .set(MEMBERSHIP.TENANT_ID, tenant2Id)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();

    // TenantContext = tenant#1 인 상태에서 tenant#2 전용 사용자를 DM 대상으로 → 거부.
    assertThatThrownBy(() -> dmService.createOrGet(callerInTenant1, List.of(userBInTenant2Only)))
        .isInstanceOf(InvalidDmRequestException.class)
        .hasMessageContaining("멤버가 아닌 사용자");
  }

  /**
   * WP-507: 1:1 DM 을 나간 사람이 같은 상대와 다시 DM 을 열면 500 대신 같은 DM 에 다시 참여한다. WP-1677 부터 1:1 은 나갈 수 없으므로, 그
   * 전에 나가 둔 기존 데이터를 멤버 행 삭제로 흉내 낸다.
   */
  @Test
  void createOrGet_afterLeavingOneToOne_rejoinsSameDm() {
    long a = seedUser();
    long b = seedUser();
    var dm = dmService.createOrGet(a, List.of(b));
    memberRepo.remove(dm.dm().id(), a);
    assertThat(memberRepo.isMember(dm.dm().id(), a)).isFalse();

    var reopened = dmService.createOrGet(a, List.of(b));

    assertThat(reopened.dm().id()).isEqualTo(dm.dm().id());
    assertThat(reopened.created()).isFalse();
    assertThat(memberRepo.isMember(dm.dm().id(), a)).isTrue();
    assertThat(memberRepo.isMember(dm.dm().id(), b)).isTrue();
  }

  /** WP-507: 그룹 DM 을 나간 사람이 같은 구성으로 다시 열면 그 그룹 DM 에 다시 참여한다. */
  @Test
  void createOrGet_afterLeavingGroup_rejoinsSameDm() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    var group = dmService.createOrGet(a, List.of(b, c));
    memberService.leave(c, group.dm().id());

    var reopened = dmService.createOrGet(c, List.of(a, b));

    assertThat(reopened.dm().id()).isEqualTo(group.dm().id());
    assertThat(memberRepo.isMember(group.dm().id(), c)).isTrue();
  }

  // ── WP-1677 그룹 DM 나가기 ──────────────────────────────────────────

  /** 1:1 DM 은 나갈 수 없다 — 400(InvalidDmRequestException) 이고 두 사람 모두 그대로 구성원이다. */
  @Test
  void leave_oneToOneDm_rejected() {
    long a = seedUser();
    long b = seedUser();
    long dm = dmService.createOrGet(a, List.of(b)).dm().id();

    assertThatThrownBy(() -> memberService.leave(a, dm))
        .isInstanceOf(InvalidDmRequestException.class)
        .hasMessage("1:1 대화는 나갈 수 없습니다");
    // 확인 카드 dry-run(사전검증)도 같은 사유로 막힌다.
    assertThatThrownBy(() -> memberService.validateLeavable(a, dm))
        .isInstanceOf(InvalidDmRequestException.class);
    assertThat(memberRepo.isMember(dm, a)).isTrue();
    assertThat(memberRepo.isMember(dm, b)).isTrue();
  }

  /** 나 혼자 DM(나에게)도 나갈 수 없다. */
  @Test
  void leave_selfDm_rejected() {
    long a = seedUser();
    long self = dmService.createOrGet(a, List.of(a)).dm().id();

    assertThatThrownBy(() -> memberService.leave(a, self))
        .isInstanceOf(InvalidDmRequestException.class)
        .hasMessage("1:1 대화는 나갈 수 없습니다");
    assertThat(memberRepo.isMember(self, a)).isTrue();
  }

  /** 3명 그룹 DM 은 나갈 수 있다 — 나간 사람만 구성원에서 빠지고 목록에서도 사라진다. */
  @Test
  void leave_groupDm_succeeds() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    long group = dmService.createOrGet(a, List.of(b, c)).dm().id();

    memberService.leave(c, group);

    assertThat(memberRepo.isMember(group, c)).isFalse();
    assertThat(memberRepo.isMember(group, a)).isTrue();
    assertThat(memberRepo.isMember(group, b)).isTrue();
    assertThat(myDmIds(c)).doesNotContain(group);
    assertThat(myDmIds(a)).contains(group);
  }

  /** 3명 그룹에서 한 명이 나가 2명만 남으면 남은 두 사람은 더 나갈 수 없다(1:1 과 같다). */
  @Test
  void leave_groupDmDownToTwo_rejected() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    long group = dmService.createOrGet(a, List.of(b, c)).dm().id();
    memberService.leave(c, group);

    assertThatThrownBy(() -> memberService.leave(a, group))
        .isInstanceOf(InvalidDmRequestException.class);
    assertThat(memberRepo.isMember(group, a)).isTrue();
  }

  /** 나간 뒤 남은 사람이 같은 구성으로 DM 을 열면 그 그룹 DM 이 열리고, 나간 사람은 다시 들어오지 않는다. */
  @Test
  void leave_groupDm_remainingReopen_doesNotRestoreLeaver() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    long group = dmService.createOrGet(a, List.of(b, c)).dm().id();
    memberService.leave(c, group);

    var reopened = dmService.createOrGet(a, List.of(b, c));

    assertThat(reopened.dm().id()).isEqualTo(group);
    assertThat(reopened.created()).isFalse();
    assertThat(memberRepo.isMember(group, c)).isFalse();
    assertThat(myDmIds(c)).doesNotContain(group);
  }

  /** 나간 사람이 같은 구성으로 다시 열면 그 그룹 DM 에 다시 참여한다(WP-507 유지). */
  @Test
  void leave_groupDm_leaverReopen_rejoins() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    long group = dmService.createOrGet(a, List.of(b, c)).dm().id();
    memberService.leave(c, group);

    var reopened = dmService.createOrGet(c, List.of(a, b));

    assertThat(reopened.dm().id()).isEqualTo(group);
    assertThat(memberRepo.isMember(group, c)).isTrue();
    assertThat(myDmIds(c)).contains(group);
  }

  /** HTTP 수준 — 1:1 DM 의 POST /leave 는 400 이고 본문 message 가 사유다. */
  @Test
  void leaveEndpoint_oneToOneDm_is400() throws Exception {
    long a = seedUser();
    long b = seedUser();
    grantUserRole(a);
    long dm = dmService.createOrGet(a, List.of(b)).dm().id();
    String token = "Bearer " + jwt.generateAccessToken(a, "u-" + a, 1L);

    mvc.perform(post("/api/v1/messaging/channels/{id}/leave", dm).header("Authorization", token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("1:1 대화는 나갈 수 없습니다"));
  }

  // ── WP-1676 DM 숨기기 ──────────────────────────────────────────────

  /** 내 DM 목록의 id 들 — 숨김 여부 판정용. */
  private List<Long> myDmIds(long userId) {
    return dmService.listMyDms(userId).stream().map(DmResponse::id).toList();
  }

  /**
   * 멤버의 hidden_at(clock_timestamp) — 테스트 트랜잭션 안의 기본 created_at(now())은 시작 시각에 고정이라 메시지 시각을 이 값 기준으로
   * 앞뒤에 둔다.
   */
  private OffsetDateTime hiddenAt(long channelId, long userId) {
    return dsl.select(CHANNEL_MEMBER.HIDDEN_AT)
        .from(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId).and(CHANNEL_MEMBER.USER_ID.eq(userId)))
        .fetchOne(CHANNEL_MEMBER.HIDDEN_AT);
  }

  /** 메시지 1건을 지정 시각으로 넣는다(답글·삭제 여부 선택). 반환 id. */
  private long seedMessage(
      long channelId, long authorId, OffsetDateTime at, Long parentId, boolean deleted) {
    return dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, authorId)
        .set(MESSAGE.BODY, "msg")
        .set(MESSAGE.CREATED_AT, at)
        .set(MESSAGE.PARENT_MESSAGE_ID, parentId)
        .set(MESSAGE.DELETED_AT, deleted ? at : null)
        .returning(MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 숨기면 내 목록에서만 빠지고 상대 목록에는 그대로 남는다. */
  @Test
  void hide_removesFromMyListOnly() {
    long a = seedUser();
    long b = seedUser();
    long dm = dmService.createOrGet(a, List.of(b)).dm().id();

    dmService.hide(a, dm);

    assertThat(myDmIds(a)).doesNotContain(dm);
    assertThat(myDmIds(b)).contains(dm);
    assertThat(memberRepo.isMember(dm, a)).isTrue(); // 기록·멤버십은 유지
  }

  /** 숨긴 뒤 상대가 새 최상위 메시지를 보내면 다시 보인다. 숨기기 전 메시지만으로는 계속 숨겨진다. */
  @Test
  void hide_thenNewMessage_reappears() {
    long a = seedUser();
    long b = seedUser();
    long dm = dmService.createOrGet(a, List.of(b)).dm().id();
    dmService.hide(a, dm);
    OffsetDateTime hidden = hiddenAt(dm, a);
    seedMessage(dm, b, hidden.minusMinutes(1), null, false);
    assertThat(myDmIds(a)).doesNotContain(dm);

    seedMessage(dm, b, hidden.plusSeconds(1), null, false);

    assertThat(myDmIds(a)).contains(dm);
  }

  /** 숨긴 뒤 스레드 답글이나 삭제된 메시지만 생기면 되살아나지 않는다(미리보기 기준과 같다). */
  @Test
  void hide_threadReplyOrDeletedMessage_staysHidden() {
    long a = seedUser();
    long b = seedUser();
    long dm = dmService.createOrGet(a, List.of(b)).dm().id();
    dmService.hide(a, dm);
    OffsetDateTime hidden = hiddenAt(dm, a);
    long root = seedMessage(dm, b, hidden.minusMinutes(1), null, false);

    seedMessage(dm, b, hidden.plusSeconds(1), root, false); // 스레드 답글
    seedMessage(dm, b, hidden.plusSeconds(2), null, true); // 삭제된 최상위

    assertThat(myDmIds(a)).doesNotContain(dm);
  }

  /** 숨긴 DM 을 같은 상대로 다시 열면 숨김이 풀리고 같은 DM(기록 유지)이 보인다. */
  @Test
  void hide_thenCreateOrGet_unhides() {
    long a = seedUser();
    long b = seedUser();
    long dm = dmService.createOrGet(a, List.of(b)).dm().id();
    seedMessage(dm, b, OffsetDateTime.now().minusDays(1), null, false);
    dmService.hide(a, dm);

    var reopened = dmService.createOrGet(a, List.of(b));

    assertThat(reopened.dm().id()).isEqualTo(dm);
    assertThat(reopened.created()).isFalse();
    assertThat(hiddenAt(dm, a)).isNull();
    assertThat(myDmIds(a)).contains(dm);
  }

  /** 그룹 DM 과 나 혼자 DM 도 숨길 수 있다. */
  @Test
  void hide_groupAndSelfDm() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    long group = dmService.createOrGet(a, List.of(b, c)).dm().id();
    long self = dmService.createOrGet(a, List.of(a)).dm().id();

    dmService.hide(a, group);
    dmService.hide(a, self);

    assertThat(myDmIds(a)).doesNotContain(group, self);
    assertThat(myDmIds(b)).contains(group);
  }

  /** 이미 숨긴 DM 을 다시 숨겨도 오류 없이 숨겨진 채로 남는다(멱등). */
  @Test
  void hide_isIdempotent() {
    long a = seedUser();
    long b = seedUser();
    long dm = dmService.createOrGet(a, List.of(b)).dm().id();

    dmService.hide(a, dm);
    dmService.hide(a, dm);

    assertThat(myDmIds(a)).doesNotContain(dm);
  }

  /** DM 이 아닌 채널은 400(InvalidDmRequestException). */
  @Test
  void hide_nonDmChannel_rejected() {
    long a = seedUser();
    long ch = channelService.create(a, "hide-" + UUID.randomUUID(), "PUBLIC").id();

    assertThatThrownBy(() -> dmService.hide(a, ch)).isInstanceOf(InvalidDmRequestException.class);
  }

  /** 없는 채널·내가 멤버가 아닌 DM 은 404(ChannelNotFoundException). */
  @Test
  void hide_missingOrNotMember_notFound() {
    long a = seedUser();
    long b = seedUser();
    long c = seedUser();
    long others = dmService.createOrGet(b, List.of(c)).dm().id();

    assertThatThrownBy(() -> dmService.hide(a, others))
        .isInstanceOf(ChannelNotFoundException.class);
    assertThatThrownBy(() -> dmService.hide(a, 999_999_999L))
        .isInstanceOf(ChannelNotFoundException.class);
  }
}
