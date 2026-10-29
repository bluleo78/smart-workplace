package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER_GROUP;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER_GROUP_EXCLUSION;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.api.DriveChannelSpacePort;
import com.workplace.drive.api.DriveChannelSpacePort.ChannelMemberSnapshot;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelMembershipChangedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.service.ChannelMemberGroupService;
import com.workplace.messaging.service.ChannelMemberGroupService.ChannelDepartmentAudienceShrunk;
import com.workplace.messaging.service.ChannelMemberGroupSync;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.outbound.DepartmentMembersGrown;
import com.workplace.user.service.UserGroupService;
import com.workplace.user.service.UserService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * 비공개 채널 멤버에 조직도 부서(부서 자체)를 둔다(WP-1058).
 *
 * <ul>
 *   <li>부서와 하위 부서의 활성 사람 구성원이 MEMBER(direct=false) 사람 행으로 채널에 들어온다 — 읽고 쓸 수 있다.
 *   <li>조직도가 바뀌면(부서에서 빠짐·들어옴·부서 삭제·이동, 구성원 정지·해제) 사람 행을 맞춘다. 직접 멤버와 ADMIN/OWNER 는 부서가 빠져도 남는다.
 *   <li>부서로 걸리는 사람을 내보내거나 그 사람이 나가면 개인 제외가 남아 다시 들어오지 않는다. 다시 초대하면 제외가 지워진다.
 *   <li>비공개 채널만(공개·DM 400), 조직도 부서만(개인 그룹 400), 관리 권한(403), 중복 409, 없는 부서 제거 404.
 *   <li>멤버 목록은 direct·viaGroupIds 를 싣고, 연동 드라이브 공간 명단이 따라간다.
 * </ul>
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다. 그래서 커밋 직전 리스너(부서 구성원 감소 뒤 맞추기)는
 * 테스트에서 기록된 이벤트로 직접 부른다(ProjectMemberGroupTest 와 같은 방식).
 */
@Transactional
@RecordApplicationEvents
class ChannelMemberGroupTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService memberService;
  @Autowired ChannelMemberGroupService memberGroupService;
  @Autowired ChannelMemberGroupSync sync;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired DmService dmService;
  @Autowired UserGroupService groupService;
  @Autowired UserService userService;
  @Autowired DriveChannelSpacePort drivePort;
  @Autowired DriveSpaceMemberRepository driveMembers;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 채널 OWNER(직접 멤버), 시스템 ADMIN — 조직도 쓰기용
  private long devMemberId; // 개발팀 직속 구성원
  private long backendMemberId; // 개발팀 > 백엔드 구성원
  private long strangerId; // 어느 부서에도 없음
  private long devId; // 조직도 부서 「개발팀」
  private long backendId; // 개발팀의 하위 부서 「백엔드」
  private long channelId; // 비공개 채널
  private String suffix;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    suffix = UUID.randomUUID().toString().substring(0, 8);
    ownerId = human();
    TestFixtures.grantRole(dsl, ownerId, "ADMIN");
    devMemberId = human();
    backendMemberId = human();
    strangerId = human();
    devId = group("개발팀-" + suffix, "SHARED", null, null);
    backendId = group("백엔드-" + suffix, "SHARED", devId, null);
    member(devId, devMemberId);
    member(backendId, backendMemberId);
    channelId = channelService.create(ownerId, "부서채널-" + suffix, "PRIVATE").id();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 부서를 더하면 부서·하위 부서 구성원이 부서 사람 행(MEMBER, direct=false)으로 들어와 읽고 쓴다. 부서 밖 사람은 막힌다. */
  @Test
  void sub_department_member_gets_row_and_can_read_and_post() throws Exception {
    JsonNode added = json(addGroup(devId, ownerId).andExpect(status().isCreated()));
    assertThat(added.get("groupId").asLong()).isEqualTo(devId);
    assertThat(added.get("name").asText()).isEqualTo("개발팀-" + suffix);
    assertThat(added.get("memberCount").asInt()).isEqualTo(2); // 직속 1 + 하위 부서 1
    assertThat(added.get("addedAt").isTextual()).isTrue(); // ISO 문자열(웹 계약)
    assertThat(java.time.Instant.parse(added.get("addedAt").asText())).isNotNull();

    for (long user : List.of(devMemberId, backendMemberId)) {
      Record row = row(user);
      assertThat(row.get(CHANNEL_MEMBER.ROLE)).isEqualTo("MEMBER");
      assertThat(row.get(CHANNEL_MEMBER.DIRECT)).isFalse();
    }
    call(get("/api/v1/messaging/channels/{id}/messages", channelId), backendMemberId)
        .andExpect(status().isOk());
    call(
            post("/api/v1/messaging/channels/{id}/messages", channelId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("body", "부서로 들어와 씁니다"))),
            backendMemberId)
        .andExpect(status().isCreated());
    // 메시지 목록은 비멤버를 403(ChannelNotMember)으로 막는다(기존 동작).
    call(get("/api/v1/messaging/channels/{id}/messages", channelId), strangerId)
        .andExpect(status().isForbidden());

    JsonNode list =
        json(
            call(get("/api/v1/messaging/channels/{id}/member-groups", channelId), backendMemberId)
                .andExpect(status().isOk()));
    assertThat(list).hasSize(1);
    assertThat(list.get(0).get("memberCount").asInt()).isEqualTo(2);
    call(get("/api/v1/messaging/channels/{id}/member-groups", channelId), strangerId)
        .andExpect(status().isNotFound());
    // 부서 사람이 들어온 roster 이벤트와 멤버십 알림이 초대와 같이 나간다.
    assertThat(lastRoster()).contains(devMemberId, backendMemberId, ownerId);
    assertThat(channelEvents()).isNotEmpty();
  }

  /** 부서에서 빠지면 커밋 직전 맞추기가 사람 행을 지운다 — 더는 읽을 수 없고(403), 빠질 사람에게도 알림이 간다. */
  @Test
  void leaving_department_removes_row_and_denies_access() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    appEvents.clear();

    groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);
    runShrunkListeners();

    assertThat(isMember(backendMemberId)).isFalse();
    assertThat(isMember(devMemberId)).isTrue();
    call(get("/api/v1/messaging/channels/{id}/messages", channelId), backendMemberId)
        .andExpect(status().isForbidden());
    // 알림은 요청 흐름에서 미리 낸다 — 빠질 사람(변경 전 멤버)이 추가 수신자.
    assertThat(channelEvents())
        .singleElement()
        .satisfies(ev -> assertThat(ev.extraRecipients()).contains(backendMemberId));
    assertThat(lastRoster()).doesNotContain(backendMemberId);
  }

  /** 나중에 부서에 들어온 사람은 증가 이벤트로 바로 들어온다. */
  @Test
  void joining_department_later_adds_row() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    long newcomer = human();
    appEvents.clear();

    groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", newcomer));

    assertThat(appEvents.stream(DepartmentMembersGrown.class))
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.groupIds()).containsExactlyInAnyOrder(backendId, devId);
              assertThat(e.userIds()).containsExactly(newcomer); // 넣은 사람만 다시 판정
            });
    assertThat(row(newcomer).get(CHANNEL_MEMBER.DIRECT)).isFalse();
    assertThat(channelEvents()).isNotEmpty();

    // 이미 구성원인 사람을 다시 넣으면(멱등 no-op) 늘어난 사람이 없어 증가 이벤트를 내지 않는다.
    appEvents.clear();
    groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", newcomer));
    assertThat(appEvents.stream(DepartmentMembersGrown.class)).isEmpty();
  }

  /**
   * 부서를 더하거나 뺄 때 들고 나는 사람이 없어도(부서 사람이 모두 직접 멤버) 부서 목록이 바뀌었으므로 채널 멤버십 변경 알림을 한 번 낸다 — 열어 둔 다른 관리자의
   * 멤버 창이 부서 목록을 바로 다시 받게. 사람 행은 그대로라 roster 이벤트는 내지 않는다.
   */
  @Test
  void group_change_without_people_change_still_notifies_once() throws Exception {
    long qaId = group("QA-" + suffix, "SHARED", null, null);
    member(qaId, strangerId);
    memberService.add(ownerId, channelId, strangerId);
    appEvents.clear();

    addGroup(qaId, ownerId).andExpect(status().isCreated());
    assertThat(channelEvents()).hasSize(1);
    assertThat(appEvents.stream(ChannelMembershipChangedEvent.class)).isEmpty();

    appEvents.clear();
    call(delete("/api/v1/messaging/channels/{id}/member-groups/{g}", channelId, qaId), ownerId)
        .andExpect(status().isNoContent());
    assertThat(channelEvents()).hasSize(1);
    assertThat(appEvents.stream(ChannelMembershipChangedEvent.class)).isEmpty();
    assertThat(row(strangerId).get(CHANNEL_MEMBER.DIRECT)).isTrue();
  }

  /** 부서에 들어온 사람이 이미 직접 멤버면 맞추기가 바꾼 것이 없어 roster·SSE 알림을 내지 않는다. */
  @Test
  void increase_without_row_change_does_not_notify() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    memberService.add(ownerId, channelId, strangerId);
    appEvents.clear();

    groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", strangerId));

    assertThat(appEvents.stream(DepartmentMembersGrown.class)).hasSize(1);
    assertThat(row(strangerId).get(CHANNEL_MEMBER.DIRECT)).isTrue();
    assertThat(channelEvents()).isEmpty();
    assertThat(appEvents.stream(ChannelMembershipChangedEvent.class)).isEmpty();
  }

  /** 부서를 지우면 부서 행이 CASCADE 로 사라지고 그 부서로만 들어와 있던 사람이 빠진다. */
  @Test
  void deleting_department_removes_department_only_members() throws Exception {
    addGroup(backendId, ownerId).andExpect(status().isCreated());
    assertThat(isMember(backendMemberId)).isTrue();

    groupService.delete(ownerId, backendId);
    runShrunkListeners();

    assertThat(dsl.fetchCount(CHANNEL_MEMBER_GROUP, CHANNEL_MEMBER_GROUP.CHANNEL_ID.eq(channelId)))
        .isZero();
    assertThat(isMember(backendMemberId)).isFalse();
  }

  /** 부서를 다른 상위 부서 아래로 옮기면 옛 상위 부서 채널에서는 빠지고 새 상위 부서 채널에는 들어온다. */
  @Test
  void moving_department_follows_new_parent() throws Exception {
    long salesId = group("영업팀-" + suffix, "SHARED", null, null);
    long salesChannel = channelService.create(ownerId, "영업채널-" + suffix, "PRIVATE").id();
    addGroup(devId, ownerId).andExpect(status().isCreated());
    call(
            post("/api/v1/messaging/channels/{id}/member-groups", salesChannel)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("groupId", salesId))),
            ownerId)
        .andExpect(status().isCreated());

    groupService.update(
        ownerId, backendId, new UpdateUserGroupRequest(null, salesId, null, null, null, null));
    runShrunkListeners();

    assertThat(isMember(backendMemberId)).isFalse();
    assertThat(memberRepo.isMember(salesChannel, backendMemberId)).isTrue();
  }

  /** 직접 멤버이면서 부서에도 걸리는 사람은 부서를 빼도 남는다 — 읽은 위치 그대로. 부서로만 들어온 사람은 빠진다. */
  @Test
  void direct_member_survives_group_removal_with_read_position() throws Exception {
    memberService.add(ownerId, channelId, devMemberId);
    addGroup(devId, ownerId).andExpect(status().isCreated());
    assertThat(row(devMemberId).get(CHANNEL_MEMBER.DIRECT)).isTrue();
    long msg = message();
    memberRepo.markRead(channelId, devMemberId, msg);

    call(delete("/api/v1/messaging/channels/{id}/member-groups/{g}", channelId, devId), ownerId)
        .andExpect(status().isNoContent());

    assertThat(row(devMemberId).get(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID)).isEqualTo(msg);
    assertThat(isMember(backendMemberId)).isFalse();
    assertThat(isMember(ownerId)).isTrue();
    // 이미 지운 부서를 다시 빼면 404.
    call(delete("/api/v1/messaging/channels/{id}/member-groups/{g}", channelId, devId), ownerId)
        .andExpect(status().isNotFound());
  }

  /**
   * 부서로 들어온 사람을 초대하면(웹의 「직접 멤버로 고정」 — POST /members) 행을 새로 만들지 않고 직접 멤버로 고정한다 — 역할·읽은 위치·가입 시각 그대로.
   * 그 뒤 부서를 빼도 남는다.
   */
  @Test
  void inviting_department_member_pins_direct_without_duplicate() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    long msg = message();
    memberRepo.markRead(channelId, backendMemberId, msg);
    var joinedAt = row(backendMemberId).get(CHANNEL_MEMBER.JOINED_AT);

    memberService.validateAdd(ownerId, channelId, backendMemberId); // 부서로만 있으면 사전검증도 통과
    call(
            post("/api/v1/messaging/channels/{id}/members", channelId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("userId", backendMemberId))),
            ownerId)
        .andExpect(status().isNoContent());

    assertThat(
            dsl.fetchCount(
                CHANNEL_MEMBER,
                CHANNEL_MEMBER
                    .CHANNEL_ID
                    .eq(channelId)
                    .and(CHANNEL_MEMBER.USER_ID.eq(backendMemberId))))
        .isEqualTo(1);
    Record row = row(backendMemberId);
    assertThat(row.get(CHANNEL_MEMBER.DIRECT)).isTrue();
    assertThat(row.get(CHANNEL_MEMBER.ROLE)).isEqualTo("MEMBER");
    assertThat(row.get(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID)).isEqualTo(msg);
    assertThat(row.get(CHANNEL_MEMBER.JOINED_AT)).isEqualTo(joinedAt);
    JsonNode members =
        json(
            call(get("/api/v1/messaging/channels/{id}/members", channelId), ownerId)
                .andExpect(status().isOk()));
    for (JsonNode m : members) {
      if (m.get("userId").asLong() == backendMemberId) {
        assertThat(m.get("direct").asBoolean()).isTrue();
        assertThat(m.get("viaGroupIds")).hasSize(1);
      }
    }
    call(delete("/api/v1/messaging/channels/{id}/member-groups/{g}", channelId, devId), ownerId)
        .andExpect(status().isNoContent());
    assertThat(isMember(backendMemberId)).isTrue();
  }

  /** 부서로 들어온 사람을 ADMIN 으로 올리면 직접 멤버로 고정된다 — 부서를 빼도 남고, MEMBER 로 내려도 고정은 그대로. */
  @Test
  void promoted_department_member_stays_after_group_removal() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    memberService.updateRole(ownerId, channelId, backendMemberId, "ADMIN");
    assertThat(row(backendMemberId).get(CHANNEL_MEMBER.DIRECT)).isTrue();
    memberService.updateRole(ownerId, channelId, backendMemberId, "MEMBER");

    memberGroupService.remove(ownerId, channelId, devId);

    Record row = row(backendMemberId);
    assertThat(row.get(CHANNEL_MEMBER.ROLE)).isEqualTo("MEMBER");
    assertThat(row.get(CHANNEL_MEMBER.DIRECT)).isTrue();
    assertThat(isMember(devMemberId)).isFalse();
  }

  /** 소유권을 부서로 들어온 사람에게 넘기면 직접 멤버로 고정된다. */
  @Test
  void ownership_transfer_pins_department_member() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    memberService.updateRole(ownerId, channelId, devMemberId, "OWNER");

    memberGroupService.remove(ownerId, channelId, devId);

    assertThat(row(devMemberId).get(CHANNEL_MEMBER.ROLE)).isEqualTo("OWNER");
    assertThat(row(devMemberId).get(CHANNEL_MEMBER.DIRECT)).isTrue();
    assertThat(row(ownerId).get(CHANNEL_MEMBER.ROLE)).isEqualTo("ADMIN");
  }

  /** 부서로 걸리는 사람을 내보내면 개인 제외가 남고, 맞추기가 다시 넣지 않는다. 부서 인원에서도 빠진다. 다시 초대하면 제외가 지워진다. */
  @Test
  void kicked_department_member_is_excluded_until_reinvited() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());

    call(delete("/api/v1/messaging/channels/{id}/members/{u}", channelId, backendMemberId), ownerId)
        .andExpect(status().isNoContent());
    assertThat(isExcluded(backendMemberId)).isTrue();

    // 부서에 다른 사람이 들어와 맞추기가 돌아도 내보낸 사람은 다시 들어오지 않는다.
    groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", human()));
    sync.reconcile(channelId);
    assertThat(isMember(backendMemberId)).isFalse();
    assertThat(memberGroupService.list(ownerId, channelId).get(0).memberCount())
        .isEqualTo(2); // 직속 1 + 새로 들어온 1 (내보낸 사람 제외)

    memberService.add(ownerId, channelId, backendMemberId);
    assertThat(isExcluded(backendMemberId)).isFalse();
    assertThat(row(backendMemberId).get(CHANNEL_MEMBER.DIRECT)).isTrue();
  }

  /** 부서로 들어온 사람이 나가면 개인 제외가 남아 다시 끌려 들어오지 않는다. 부서에 걸리지 않는 사람은 제외를 남기지 않는다. */
  @Test
  void leaving_channel_excludes_department_member() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    memberService.add(ownerId, channelId, strangerId);

    call(post("/api/v1/messaging/channels/{id}/leave", channelId), devMemberId)
        .andExpect(status().isNoContent());
    memberService.leave(strangerId, channelId);

    assertThat(isExcluded(devMemberId)).isTrue();
    assertThat(isExcluded(strangerId)).isFalse();
    sync.reconcile(channelId);
    assertThat(isMember(devMemberId)).isFalse();
  }

  /**
   * 구성원을 정지해도 부서 사람 행은 남는다 — 정지가 이미 접근을 막는다(토큰 401). 정지된 동안 다른 맞추기가 돌아도 빠지지 않고, 정지를 풀면 같은 행 그대로(읽은
   * 위치·가입 시각) 다시 읽는다. 정지된 동안 부서에 걸린 사람은 넣지 않고, 풀면 증가 이벤트로 들어온다.
   */
  @Test
  void suspension_keeps_department_row_and_read_position() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    long msg = message();
    memberRepo.markRead(channelId, backendMemberId, msg);
    Record before = row(backendMemberId);

    userService.setUserActive(backendMemberId, false, ownerId);
    // 정지된 동안 맞추기가 돌아도(부서 행 추가) 빠지지 않는다 — 정지된 사람은 아직 부서로 걸린다.
    addGroup(backendId, ownerId).andExpect(status().isCreated());
    sync.reconcile(channelId);
    assertThat(isMember(backendMemberId)).isTrue();
    call(get("/api/v1/messaging/channels/{id}/messages", channelId), backendMemberId)
        .andExpect(status().isUnauthorized());
    // 정지된 사람은 인원 수(활성 기준)에서 빠지지만, 멤버 목록에는 어느 부서로 들어왔는지 남는다.
    assertThat(
            memberGroupService.list(ownerId, channelId).stream()
                .filter(g -> g.groupId() == backendId)
                .findFirst()
                .orElseThrow()
                .memberCount())
        .isZero();
    assertThat(
            memberService.listMembers(ownerId, channelId).stream()
                .filter(m -> m.userId() == backendMemberId)
                .findFirst()
                .orElseThrow()
                .viaGroupIds())
        .containsExactly(devId, backendId);

    // 정지된 동안 부서에 걸린 사람은 넣지 않는다(정지된 사람은 조직도 API 로 넣을 수 없어 시드로 넣고 맞춘다).
    long suspendedNewcomer = human();
    userService.setUserActive(suspendedNewcomer, false, ownerId);
    member(backendId, suspendedNewcomer);
    sync.reconcile(channelId);
    assertThat(isMember(suspendedNewcomer)).isFalse();

    userService.setUserActive(backendMemberId, true, ownerId);
    Record after = row(backendMemberId);
    assertThat(after.get(CHANNEL_MEMBER.DIRECT)).isFalse();
    assertThat(after.get(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID)).isEqualTo(msg);
    assertThat(after.get(CHANNEL_MEMBER.JOINED_AT)).isEqualTo(before.get(CHANNEL_MEMBER.JOINED_AT));
    call(get("/api/v1/messaging/channels/{id}/messages", channelId), backendMemberId)
        .andExpect(status().isOk());

    userService.setUserActive(suspendedNewcomer, true, ownerId);
    assertThat(row(suspendedNewcomer).get(CHANNEL_MEMBER.DIRECT)).isFalse();
  }

  /** 정지된 부서 사람도 부서에서 빠지면 행이 빠진다 — 정지만으로는 빠지지 않을 뿐이다. */
  @Test
  void suspended_member_leaving_department_is_removed() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    userService.setUserActive(backendMemberId, false, ownerId);

    groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);
    runShrunkListeners();

    assertThat(isMember(backendMemberId)).isFalse();
  }

  /** 보관된 채널에는 부서 사람을 새로 넣지 않는다(빼기는 한다). 보관을 풀면 그동안 들어온 사람이 들어온다. */
  @Test
  void archived_channel_gets_no_inserts_but_removals_until_unarchived() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    channelService.archive(ownerId, channelId);
    long newcomer = human();

    groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", newcomer));
    assertThat(isMember(newcomer)).isFalse();

    groupService.removeMember(ownerId, devId, "MEMBER", devMemberId);
    runShrunkListeners();
    assertThat(isMember(devMemberId)).isFalse();

    channelService.unarchive(ownerId, channelId);
    assertThat(row(newcomer).get(CHANNEL_MEMBER.DIRECT)).isFalse();
    assertThat(isMember(devMemberId)).isFalse();
  }

  /**
   * 멤버 부서를 빼면 이제 어느 부서에도 걸리지 않는 사람의 개인 제외가 지워진다 — 나중에 그 사람이 걸리는 부서를 더하면 다시 들어온다. 남은 부서로 여전히 걸리면 제외는
   * 남는다.
   */
  @Test
  void removing_group_clears_exclusions_of_people_no_longer_covered() throws Exception {
    long qaId = group("QA-" + suffix, "SHARED", null, null);
    member(qaId, backendMemberId);
    member(qaId, devMemberId);
    addGroup(backendId, ownerId).andExpect(status().isCreated());
    addGroup(devId, ownerId).andExpect(status().isCreated());
    memberService.remove(ownerId, channelId, backendMemberId); // 백엔드·개발팀 둘 다로 걸린다
    memberService.leave(devMemberId, channelId); // 개발팀으로만 걸린다
    assertThat(isExcluded(backendMemberId)).isTrue();
    assertThat(isExcluded(devMemberId)).isTrue();

    // 백엔드 부서를 빼도 개발팀(상위)으로 여전히 걸리는 사람의 제외는 남는다.
    memberGroupService.remove(ownerId, channelId, backendId);
    assertThat(isExcluded(backendMemberId)).isTrue();
    assertThat(isExcluded(devMemberId)).isTrue();

    // 개발팀까지 빼면 둘 다 어느 부서에도 걸리지 않아 제외가 지워지고, 나중에 더한 부서(QA)로 다시 들어온다.
    memberGroupService.remove(ownerId, channelId, devId);
    assertThat(isExcluded(backendMemberId)).isFalse();
    assertThat(isExcluded(devMemberId)).isFalse();
    addGroup(qaId, ownerId).andExpect(status().isCreated());
    assertThat(isMember(backendMemberId)).isTrue();
    assertThat(isMember(devMemberId)).isTrue();
  }

  /** 공개 채널·DM 에는 부서를 둘 수 없다(400). 개인 그룹·없는 그룹 400. 중복 409. 보관된 채널 409. */
  @Test
  void rejects_public_channel_dm_personal_group_duplicates_and_archived() throws Exception {
    long publicChannel = channelService.create(ownerId, "공개채널-" + suffix, "PUBLIC").id();
    call(
            post("/api/v1/messaging/channels/{id}/member-groups", publicChannel)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("groupId", devId))),
            ownerId)
        .andExpect(status().isBadRequest());
    long dm = dmService.createOrGet(devMemberId, List.of(strangerId)).dm().id();
    call(
            post("/api/v1/messaging/channels/{id}/member-groups", dm)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("groupId", devId))),
            devMemberId)
        .andExpect(status().isBadRequest());
    // DM 비참여자(관리자 아님)에게는 존재를 숨긴다.
    call(
            post("/api/v1/messaging/channels/{id}/member-groups", dm)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("groupId", devId))),
            backendMemberId)
        .andExpect(status().isNotFound());

    long personal = group("내그룹-" + suffix, "PERSONAL", null, ownerId);
    member(personal, strangerId);
    addGroup(personal, ownerId).andExpect(status().isBadRequest());
    addGroup(-1L, ownerId).andExpect(status().isBadRequest());
    assertThat(dsl.fetchCount(CHANNEL_MEMBER_GROUP)).isZero();
    assertThat(isMember(strangerId)).isFalse();

    addGroup(devId, ownerId).andExpect(status().isCreated());
    addGroup(devId, ownerId).andExpect(status().isConflict());

    channelService.archive(ownerId, channelId);
    addGroup(backendId, ownerId).andExpect(status().isConflict());
  }

  /** 관리 권한이 없는 멤버(부서로 들어온 MEMBER)는 부서를 더하거나 뺄 수 없다 — 403. 비멤버는 404. */
  @Test
  void non_manager_cannot_add_or_remove_groups() throws Exception {
    addGroup(devId, ownerId).andExpect(status().isCreated());
    addGroup(backendId, devMemberId).andExpect(status().isForbidden());
    call(delete("/api/v1/messaging/channels/{id}/member-groups/{g}", channelId, devId), devMemberId)
        .andExpect(status().isForbidden());
    addGroup(backendId, strangerId).andExpect(status().isNotFound());
  }

  /** 멤버 목록은 direct 와 이 채널의 멤버 부서 중 그 사람이 걸리는 부서(viaGroupIds)를 싣는다. */
  @Test
  void members_list_returns_direct_and_via_group_ids() throws Exception {
    memberService.add(ownerId, channelId, devMemberId);
    addGroup(devId, ownerId).andExpect(status().isCreated());
    addGroup(backendId, ownerId).andExpect(status().isCreated());

    JsonNode members =
        json(
            call(get("/api/v1/messaging/channels/{id}/members", channelId), backendMemberId)
                .andExpect(status().isOk()));
    assertThat(members).hasSize(3);
    for (JsonNode m : members) {
      long user = m.get("userId").asLong();
      List<Long> via =
          om.convertValue(
              m.get("viaGroupIds"),
              om.getTypeFactory().constructCollectionType(List.class, Long.class));
      if (user == ownerId) {
        assertThat(m.get("direct").asBoolean()).isTrue();
        assertThat(via).isEmpty();
      } else if (user == devMemberId) {
        assertThat(m.get("direct").asBoolean()).isTrue();
        assertThat(via).containsExactly(devId);
      } else {
        assertThat(user).isEqualTo(backendMemberId);
        assertThat(m.get("direct").asBoolean()).isFalse();
        assertThat(via).containsExactly(devId, backendId); // 오름차순
      }
    }
  }

  /** 연동 드라이브 공간 명단이 부서 사람을 따라간다 — 부서를 더하면 편집자로 들어오고 빼면 빠진다. */
  @Test
  void channel_drive_space_roster_follows() throws Exception {
    var space =
        drivePort.ensureChannelSpace(
            ownerId, channelId, "부서채널", List.of(new ChannelMemberSnapshot(ownerId, "OWNER")));
    assertThat(driveMembers.findRole(space.id(), backendMemberId)).isEmpty();

    addGroup(devId, ownerId).andExpect(status().isCreated());
    assertThat(driveMembers.findRole(space.id(), backendMemberId)).isPresent();

    groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);
    runShrunkListeners();
    assertThat(driveMembers.findRole(space.id(), backendMemberId)).isEmpty();
    assertThat(driveMembers.findRole(space.id(), devMemberId)).isPresent();
  }

  // --- 헬퍼 ---

  /** 기록된 커밋 직전 맞추기 이벤트를 부른다 — 테스트 트랜잭션은 롤백이라 커밋 직전 리스너가 돌지 않는다. */
  private void runShrunkListeners() {
    List<ChannelDepartmentAudienceShrunk> events =
        appEvents.stream(ChannelDepartmentAudienceShrunk.class).toList();
    assertThat(events).isNotEmpty();
    events.forEach(memberGroupService::onDepartmentAudienceShrunk);
  }

  private ResultActions addGroup(long groupId, long caller) throws Exception {
    return call(
        post("/api/v1/messaging/channels/{id}/member-groups", channelId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(Map.of("groupId", groupId))),
        caller);
  }

  /** 이 채널에 대한 channel 리소스 변경 알림(발행 순). */
  private List<ResourceChangedEvent> channelEvents() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(ev -> "channel".equals(ev.resource()) && ev.ids().contains(channelId))
        .toList();
  }

  /** 이 채널의 마지막 roster 이벤트의 사람 id. */
  private List<Long> lastRoster() {
    List<ChannelMembershipChangedEvent> events =
        appEvents.stream(ChannelMembershipChangedEvent.class)
            .filter(e -> e.channelId() == channelId)
            .toList();
    assertThat(events).isNotEmpty();
    return events.get(events.size() - 1).members().stream()
        .map(ChannelMembershipChangedEvent.Member::userId)
        .toList();
  }

  private boolean isMember(long userId) {
    return memberRepo.isMember(channelId, userId);
  }

  private Record row(long userId) {
    return dsl.selectFrom(CHANNEL_MEMBER)
        .where(CHANNEL_MEMBER.CHANNEL_ID.eq(channelId))
        .and(CHANNEL_MEMBER.USER_ID.eq(userId))
        .fetchOne();
  }

  private boolean isExcluded(long userId) {
    return dsl.fetchExists(
        CHANNEL_MEMBER_GROUP_EXCLUSION,
        CHANNEL_MEMBER_GROUP_EXCLUSION
            .CHANNEL_ID
            .eq(channelId)
            .and(CHANNEL_MEMBER_GROUP_EXCLUSION.USER_ID.eq(userId)));
  }

  /** 채널에 메시지 한 건(OWNER 작성) — 읽은 위치 확인용. */
  private long message() {
    return dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, ownerId)
        .set(MESSAGE.BODY, "안녕하세요")
        .returning(MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    return id;
  }

  /** 그룹 시드 — PERSONAL 이면 owner 가 소유자. */
  private long group(String name, String visibility, Long parentId, Long owner) {
    return dsl.insertInto(USER_GROUP)
        .set(USER_GROUP.NAME, name)
        .set(USER_GROUP.VISIBILITY, visibility)
        .set(USER_GROUP.PARENT_ID, parentId)
        .set(USER_GROUP.OWNER_ID, owner)
        .returning(USER_GROUP.ID)
        .fetchOne()
        .getId();
  }

  private void member(long groupId, long userId) {
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, userId)
        .execute();
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
  }

  private ResultActions call(MockHttpServletRequestBuilder req, long userId) throws Exception {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(userId, "u-" + userId, 1L));
    ResultActions r = mvc.perform(req);
    TenantContext.set(1L);
    return r;
  }
}
