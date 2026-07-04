package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelMemberResponse;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.AgentCannotOwnChannelException;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.OwnershipTransferRequiredException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserKind;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** ChannelMemberService 통합 테스트 — 초대/제거/나가기/소유권 이전. */
@Transactional
class ChannelMemberServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired ChannelMemberRepository memberRepo;

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

  /** 고유 user 1행 insert 후 id 반환. tenant#1 ACTIVE 멤버십도 함께 삽입하여 채널 멤버 추가 시 테넌트 경계 검증을 통과시킨다. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "cms_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Cms" + s)
            .set(USER.EMAIL, "cms_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // tenant#1 ACTIVE 멤버십 부여 — 채널 멤버 추가 테넌트 경계 검증 통과용.
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 시스템 ADMIN 역할을 가진 사용자 — 채널 비멤버여도 권한 오버라이드를 검증하기 위함. */
  private long seedAdminUser() {
    long id = seedUser();
    Long adminRoleId =
        dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, adminRoleId)
        .execute();
    return id;
  }

  /** AGENT(AI 봇) 종류의 사용자 — 채널 OWNER 승격 거부(#598)를 검증하기 위함. */
  private long seedAgentUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "cms_agent_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "CmsAgent" + s)
            .set(USER.EMAIL, "cms_agent_" + s + "@example.com")
            .set(USER.KIND, UserKind.AGENT)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  @Test
  void updateRole_systemAdminTransfer_demotesActualOwner_keepsSingleOwner() {
    // 시스템 ADMIN(채널 비멤버)이 소유권을 이전하면 호출자가 아니라 "현재 OWNER" 가 강등되어야 한다.
    long owner = seedUser();
    long target = seedUser();
    long sysAdmin = seedAdminUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), target);

    memberService.updateRole(sysAdmin, ch.id(), target, "OWNER");

    assertThat(memberRepo.findRole(ch.id(), target)).contains("OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");
    long ownerCount =
        memberRepo.listMembers(ch.id()).stream().filter(m -> "OWNER".equals(m.role())).count();
    assertThat(ownerCount).isEqualTo(1);
  }

  @Test
  void add_byOwner_succeeds_byMemberForbidden() {
    long owner = seedUser();
    long target = seedUser();
    long bystander = seedUser();
    ChannelResponse ch = channelService.create(owner, "비공개", "PRIVATE");

    memberService.add(owner, ch.id(), target);
    assertThat(memberRepo.isMember(ch.id(), target)).isTrue();
    assertThat(memberRepo.findRole(ch.id(), target)).contains("MEMBER");

    // 멤버(권한없음)가 추가 시도 → 403
    assertThatThrownBy(() -> memberService.add(target, ch.id(), bystander))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void remove_ownerCannotBeRemoved() {
    long owner = seedUser();
    long admin = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), admin);
    memberService.updateRole(owner, ch.id(), admin, "ADMIN");

    assertThatThrownBy(() -> memberService.remove(admin, ch.id(), owner))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  @Test
  void listMembers_memberOnly() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "비공개", "PRIVATE");
    List<ChannelMemberResponse> members = memberService.listMembers(owner, ch.id());
    assertThat(members).hasSize(1);
    // 비멤버 조회 → 404 은닉
    assertThatThrownBy(() -> memberService.listMembers(seedUser(), ch.id()))
        .isInstanceOf(RuntimeException.class);
  }

  @Test
  void leave_ownerWithMembers_throws409_thenTransferThenLeave() {
    long owner = seedUser();
    long other = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), other);

    // OWNER 가 멤버 남긴 채 나가기 → 409
    assertThatThrownBy(() -> memberService.leave(owner, ch.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);

    // 소유권 이전: other 를 OWNER 로 → 본인은 ADMIN 강등
    memberService.updateRole(owner, ch.id(), other, "OWNER");
    assertThat(memberRepo.findRole(ch.id(), other)).contains("OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");

    // 이제 나가기 가능
    memberService.leave(owner, ch.id());
    assertThat(memberRepo.isMember(ch.id(), owner)).isFalse();
  }

  @Test
  void leave_soleOwner_throws409() {
    long owner = seedUser();
    ChannelResponse ch = channelService.create(owner, "혼자", "PRIVATE");
    assertThatThrownBy(() -> memberService.leave(owner, ch.id()))
        .isInstanceOf(OwnershipTransferRequiredException.class);
  }

  @Test
  void leave_member_succeeds() {
    long owner = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "공개", "PUBLIC");
    channelService.join(member, ch.id());
    memberService.leave(member, ch.id());
    assertThat(memberRepo.isMember(ch.id(), member)).isFalse();
  }

  @Test
  void updateRole_transferOwner_demotesPreviousOwner() {
    long owner = seedUser();
    long target = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), target);
    memberService.updateRole(owner, ch.id(), target, "OWNER");
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("ADMIN");
    assertThat(memberRepo.findRole(ch.id(), target)).contains("OWNER");
  }

  /** AGENT(AI 봇) 사용자를 OWNER 로 승격 시도 → 409, 기존 OWNER/대상 역할 모두 변경되지 않아야 한다(#598). */
  @Test
  void updateRole_toAgentOwner_throws409_andRosterUnchanged() {
    long owner = seedUser();
    long agent = seedAgentUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), agent);

    assertThatThrownBy(() -> memberService.updateRole(owner, ch.id(), agent, "OWNER"))
        .isInstanceOf(AgentCannotOwnChannelException.class);

    // 거부 후에도 소유권 이전이 실행되지 않았어야 함(기존 OWNER 유지, 대상은 MEMBER 유지).
    assertThat(memberRepo.findRole(ch.id(), owner)).contains("OWNER");
    assertThat(memberRepo.findRole(ch.id(), agent)).contains("MEMBER");
  }

  @Test
  void updateRole_byNonOwner_throws403() {
    long owner = seedUser();
    long admin = seedUser();
    long member = seedUser();
    ChannelResponse ch = channelService.create(owner, "일반", "PUBLIC");
    memberService.add(owner, ch.id(), admin);
    memberService.updateRole(owner, ch.id(), admin, "ADMIN");
    memberService.add(owner, ch.id(), member);

    assertThatThrownBy(() -> memberService.updateRole(admin, ch.id(), member, "ADMIN"))
        .isInstanceOf(ChannelForbiddenException.class);
  }

  /** 타 테넌트(tenant#2) 전용 사용자를 채널 멤버로 추가하면 거부되어야 한다. 테넌트 경계를 넘는 채널 멤버십을 서비스 계층에서 차단함을 검증한다(설계 §4). */
  @Test
  void add_crossTenantUser_throwsForbidden() {
    long owner = seedUser(); // tenant#1 멤버

    // tenant#2 생성 + userB 는 tenant#2 에만 소속
    String slug = "test-ch-t2-" + UUID.randomUUID().toString().substring(0, 8);
    long tenant2Id =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "Channel Cross Tenant Test")
            .set(TENANT.SLUG, slug)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long userBInTenant2Only =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ch_t2_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "ChT2" + s)
            .set(USER.EMAIL, "ch_t2_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    // tenant#2 에만 ACTIVE 멤버십 부여(tenant#1 멤버십 없음).
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userBInTenant2Only)
        .set(MEMBERSHIP.TENANT_ID, tenant2Id)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();

    ChannelResponse ch = channelService.create(owner, "테넌트경계테스트채널", "PRIVATE");

    // TenantContext = tenant#1 인 상태에서 tenant#2 전용 사용자를 채널에 추가 → 거부.
    assertThatThrownBy(() -> memberService.add(owner, ch.id(), userBInTenant2Only))
        .isInstanceOf(ChannelForbiddenException.class);

    // 긍정 회귀: tenant#1 멤버(owner 본인) 추가는 성공한다(이미 OWNER 이므로 idempotent).
    // tenant#1 멤버인 새 사용자 추가도 성공해야 함.
    long anotherTenant1User = seedUser();
    memberService.add(owner, ch.id(), anotherTenant1User);
    assertThat(memberRepo.isMember(ch.id(), anotherTenant1User)).isTrue();
  }
}
