package com.workplace.drive;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER_GROUP;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.drive.api.DriveChannelSpacePort;
import com.workplace.drive.api.DriveChannelSpacePort.ChannelMemberSnapshot;
import com.workplace.drive.outbound.DriveChangeNotifier;
import com.workplace.drive.outbound.DriveSpaceAudienceResolver;
import com.workplace.drive.repository.DriveContentSearchRepository;
import com.workplace.drive.repository.DriveContentSearchRepository.ContentRow;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.service.UserGroupService;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
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
 * 드라이브 팀 공간 멤버에 조직도 부서(부서 자체)를 둔다(WP-1056) — 노트 스페이스(WP-1052)와 같은 규칙.
 *
 * <ul>
 *   <li>부서와 하위 부서의 활성 사람 구성원이 부서 행의 역할로 공간을 읽고(VIEWER)·고친다(EDITOR). 소속은 판정 때마다 다시 본다(빠지거나 정지되면 바로
 *       막힌다).
 *   <li>실효 역할 = 직접 멤버 역할과 부서 역할 중 가장 높은 것 — 공간 단건·「내 공간」 목록이 같은 값을 보이고, 양쪽에 걸려도 한 번만.
 *   <li>부서 행은 팀 공간에만, EDITOR·VIEWER 만, 조직도 부서(SHARED)만. 변경은 OWNER 만. 마지막 소유자 보호는 직접 멤버 행만 본다.
 *   <li>콘텐츠 검색은 부서로만 들어온 사람도 찾고, 직접·부서 양쪽에 걸려도 파일을 한 번만 낸다.
 *   <li>부서 행 변경·부서 구성원 감소는 공간 변경 알림을 내고, 바뀌기 전 실효 멤버를 추가 수신자로 넘긴다.
 * </ul>
 *
 * <p>@Transactional: MockMvc 요청이 테스트 트랜잭션에 합류해 시드를 보고 끝나면 롤백된다. 그래서 커밋 직전 디스패처(수신자 조회)는 돌지 않는다 —
 * 알림은 발행된 {@link ResourceChangedEvent} 로, 수신자 조회는 {@link DriveSpaceAudienceResolver} 를 직접 불러 검증한다.
 */
@Transactional
@RecordApplicationEvents
class DriveSpaceMemberGroupTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveChannelSpacePort channelSpaces;
  @Autowired DriveSpaceAudienceResolver audience;
  @Autowired DriveContentSearchRepository contentSearch;
  @Autowired DriveSpaceMemberRepository spaceMembers;
  @Autowired UserGroupService groupService;
  @Autowired ApplicationEvents appEvents;

  private long ownerId; // 공간 OWNER(직접 멤버)
  private long devMemberId; // 개발팀 직속 구성원(공간 직접 멤버 아님)
  private long backendMemberId; // 개발팀 > 백엔드 구성원
  private long strangerId; // 어느 부서에도 없음
  private long spaceId;
  private long devId; // 조직도 부서 「개발팀」
  private long backendId; // 개발팀의 하위 부서 「백엔드」
  private String suffix;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    ownerId = human();
    devMemberId = human();
    backendMemberId = human();
    strangerId = human();
    spaceId = spaceService.createTeamSpace(ownerId, "부서멤버-" + suffix).id();
    devId = group("개발팀-" + suffix, "SHARED", null, null);
    backendId = group("백엔드-" + suffix, "SHARED", devId, null);
    member(devId, devMemberId);
    member(backendId, backendMemberId);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 부서 EDITOR — 부서·하위 부서 구성원은 목록을 읽고 폴더를 만들 수 있고, 「내 공간」에 부서 역할로 보인다. 부서 밖 사람은 비멤버(404). */
  @Test
  void department_and_sub_department_members_read_edit_and_see_space() throws Exception {
    addGroup(devId, "EDITOR").andExpect(status().isCreated());

    for (long user : List.of(devMemberId, backendMemberId)) {
      call(get("/api/v1/drive/spaces/{id}/items", spaceId), user).andExpect(status().isOk());
      createFolder(user).andExpect(status().isCreated());
      call(get("/api/v1/drive/spaces/{id}", spaceId), user)
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.role").value("EDITOR"));
      List<JsonNode> mine = matching(json(call(get("/api/v1/drive/spaces"), user)), spaceId);
      assertThat(mine)
          .singleElement()
          .satisfies(s -> assertThat(s.get("role").asText()).isEqualTo("EDITOR"));
    }
    call(get("/api/v1/drive/spaces/{id}/items", spaceId), strangerId)
        .andExpect(status().isNotFound());
    assertThat(matching(json(call(get("/api/v1/drive/spaces"), strangerId)), spaceId)).isEmpty();
  }

  /** 부서 VIEWER 는 읽기만 — 폴더 만들기 403. 부서 구성원이라도 멤버 관리(OWNER)는 할 수 없다(목록 조회는 된다). */
  @Test
  void department_viewer_reads_only_and_cannot_manage() throws Exception {
    addGroup(devId, "VIEWER").andExpect(status().isCreated());

    call(get("/api/v1/drive/spaces/{id}/items", spaceId), devMemberId).andExpect(status().isOk());
    createFolder(devMemberId).andExpect(status().isForbidden());
    call(get("/api/v1/drive/spaces/{id}/member-groups", spaceId), devMemberId)
        .andExpect(status().isOk());
    call(
            post("/api/v1/drive/spaces/{id}/member-groups", spaceId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("groupId", backendId, "role", "EDITOR"))),
            devMemberId)
        .andExpect(status().isForbidden());
    call(patchGroup(devId, "EDITOR"), devMemberId).andExpect(status().isForbidden());
    call(delete("/api/v1/drive/spaces/{id}/member-groups/{g}", spaceId, devId), devMemberId)
        .andExpect(status().isForbidden());
    // 비멤버는 존재도 모른다(404).
    call(get("/api/v1/drive/spaces/{id}/member-groups", spaceId), strangerId)
        .andExpect(status().isNotFound());
  }

  /**
   * 멤버 목록의 부서 역할(WP-1102) — 직접 멤버마다 멤버 부서로 받는 가장 높은 역할을 함께 싣는다. 직접 VIEWER 인 개발팀 구성원은 부서 EDITOR 를,
   * 하위 부서 구성원도 상위 부서의 역할을 받고, 부서에 없는 소유자는 null 이다.
   */
  @Test
  void member_list_carries_department_role() throws Exception {
    spaceService.addMember(ownerId, spaceId, devMemberId, "VIEWER");
    spaceService.addMember(ownerId, spaceId, backendMemberId, "VIEWER");
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    addGroup(backendId, "VIEWER").andExpect(status().isCreated());

    JsonNode list =
        json(
            call(get("/api/v1/drive/spaces/{id}/members", spaceId), ownerId)
                .andExpect(status().isOk()));
    Map<Long, JsonNode> byUser = new HashMap<>();
    list.forEach(n -> byUser.put(n.get("userId").asLong(), n));
    assertThat(byUser.get(devMemberId).get("role").asText()).isEqualTo("VIEWER");
    assertThat(byUser.get(devMemberId).get("departmentRole").asText()).isEqualTo("EDITOR");
    // 백엔드는 자기 부서(VIEWER)와 상위 부서(EDITOR) 중 높은 쪽.
    assertThat(byUser.get(backendMemberId).get("departmentRole").asText()).isEqualTo("EDITOR");
    assertThat(byUser.get(ownerId).get("departmentRole").isNull()).isTrue();
  }

  /**
   * 실효 역할은 가장 높은 것 — 직접 VIEWER + 부서 EDITOR → EDITOR(목록에 한 번만). 거꾸로 직접 EDITOR + 부서 VIEWER 도 EDITOR.
   */
  @Test
  void highest_role_wins() throws Exception {
    spaceService.addMember(ownerId, spaceId, devMemberId, "VIEWER");
    addGroup(devId, "EDITOR").andExpect(status().isCreated());

    call(get("/api/v1/drive/spaces/{id}", spaceId), devMemberId)
        .andExpect(jsonPath("$.role").value("EDITOR"));
    List<JsonNode> mine = matching(json(call(get("/api/v1/drive/spaces"), devMemberId)), spaceId);
    assertThat(mine).hasSize(1); // 직접·부서 양쪽에 걸려도 한 번만
    assertThat(mine.get(0).get("role").asText()).isEqualTo("EDITOR");
    createFolder(devMemberId).andExpect(status().isCreated());

    // 직접 EDITOR + 부서 VIEWER → EDITOR.
    spaceService.changeRole(ownerId, spaceId, devMemberId, "EDITOR");
    changeGroup(devId, "VIEWER").andExpect(status().isOk());
    call(get("/api/v1/drive/spaces/{id}", spaceId), devMemberId)
        .andExpect(jsonPath("$.role").value("EDITOR"));
    createFolder(devMemberId).andExpect(status().isCreated());

    // 직접 VIEWER + 부서 VIEWER → VIEWER(쓰기 403).
    spaceService.changeRole(ownerId, spaceId, devMemberId, "VIEWER");
    createFolder(devMemberId).andExpect(status().isForbidden());
  }

  /** 부서에서 빠지거나 워크스페이스에서 정지되면 바로 막히고 「내 공간」에서도 사라진다 — 소속은 판정 때마다 다시 본다. */
  @Test
  void removed_or_suspended_department_member_loses_access() throws Exception {
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    call(get("/api/v1/drive/spaces/{id}/items", spaceId), backendMemberId)
        .andExpect(status().isOk());

    dsl.deleteFrom(USER_GROUP_MEMBER)
        .where(USER_GROUP_MEMBER.GROUP_ID.eq(backendId))
        .and(USER_GROUP_MEMBER.TARGET_ID.eq(backendMemberId))
        .execute();
    call(get("/api/v1/drive/spaces/{id}/items", spaceId), backendMemberId)
        .andExpect(status().isNotFound());
    assertThat(matching(json(call(get("/api/v1/drive/spaces"), backendMemberId)), spaceId))
        .isEmpty();

    // 정지된 구성원은 부서에 들어 있어도 세지 않는다.
    TestFixtures.suspendMember(dsl, devMemberId, 1L);
    assertThat(audience.resolve(spaceId)).doesNotContain(devMemberId);
    // 정지된 사람은 요청 자체가 막히므로 권한 판정이 쓰는 실효 역할을 직접 본다.
    assertThat(spaceMembers.findRole(spaceId, devMemberId)).isEmpty();
    // 다시 활성이 되면 다시 들어온다.
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .where(MEMBERSHIP.USER_ID.eq(devMemberId))
        .and(MEMBERSHIP.TENANT_ID.eq(1L))
        .execute();
    assertThat(audience.resolve(spaceId)).contains(devMemberId);
    assertThat(spaceMembers.findRole(spaceId, devMemberId)).contains("EDITOR");
  }

  /** 부서로만 들어온 사람은 바꿀 직접 멤버 행이 없다 — 사람 멤버 역할 변경은 404(0행 UPDATE 를 성공으로 돌려주지 않는다, WP-667). */
  @Test
  void direct_member_role_change_ignores_department_only_member() throws Exception {
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    call(
            patch("/api/v1/drive/spaces/{id}/members/{u}", spaceId, devMemberId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("role", "VIEWER"))),
            ownerId)
        .andExpect(status().isNotFound());
  }

  /**
   * 마지막 소유자 보호는 직접 멤버 행만 본다 — 부서 EDITOR 가 있어도 유일한 직접 OWNER 는 빠지거나 내려갈 수 없다(409). 부서 행은 OWNER 를 받지
   * 않으므로 부서 구성원이 소유자를 대신할 수 없다.
   */
  @Test
  void last_owner_protection_unaffected_by_department() throws Exception {
    member(devId, ownerId); // 소유자도 부서 구성원(부서 EDITOR) — 직접 OWNER 가 실효 역할
    addGroup(devId, "EDITOR").andExpect(status().isCreated());

    call(delete("/api/v1/drive/spaces/{id}/members/{u}", spaceId, ownerId), ownerId)
        .andExpect(status().isConflict());
    call(
            patch("/api/v1/drive/spaces/{id}/members/{u}", spaceId, ownerId)
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("role", "EDITOR"))),
            ownerId)
        .andExpect(status().isConflict());
    call(get("/api/v1/drive/spaces/{id}", spaceId), ownerId)
        .andExpect(jsonPath("$.role").value("OWNER"));
  }

  /** 부서 행은 EDITOR·VIEWER 만, 조직도 부서만 — OWNER·모르는 역할·개인 그룹·없는 그룹은 400. */
  @Test
  void rejects_owner_role_personal_and_missing_groups() throws Exception {
    addGroup(devId, "OWNER")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("부서에는 편집 또는 보기 역할만 줄 수 있습니다"));
    addGroup(devId, "ADMIN").andExpect(status().isBadRequest());
    long personal = group("내그룹-" + suffix, "PERSONAL", null, ownerId);
    member(personal, strangerId);
    addGroup(personal, "EDITOR")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("조직도 부서만 지정할 수 있습니다"));
    addGroup(-1L, "EDITOR").andExpect(status().isBadRequest());
    assertThat(dsl.fetchCount(DRIVE_SPACE_MEMBER_GROUP)).isZero();

    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    changeGroup(devId, "OWNER").andExpect(status().isBadRequest());
  }

  /** 개인 공간·채널 공간에는 부서를 둘 수 없다 — 사람 멤버 변경과 같은 409. */
  @Test
  void rejects_personal_and_channel_spaces() throws Exception {
    long personalSpace = spaceService.ensurePersonalSpace(ownerId).id();
    call(addGroupReq(personalSpace, devId, "EDITOR"), ownerId).andExpect(status().isConflict());

    long channelId =
        dsl.insertInto(CHANNEL)
            .set(CHANNEL.CREATED_BY, ownerId)
            .returning(CHANNEL.ID)
            .fetchOne()
            .getId();
    long channelSpace =
        channelSpaces
            .ensureChannelSpace(
                ownerId,
                channelId,
                "채널-" + suffix,
                List.of(new ChannelMemberSnapshot(ownerId, "OWNER")))
            .id();
    call(addGroupReq(channelSpace, devId, "EDITOR"), ownerId).andExpect(status().isConflict());
    assertThat(dsl.fetchCount(DRIVE_SPACE_MEMBER_GROUP)).isZero();
  }

  /**
   * member-groups CRUD — 추가 201(이름·역할·하위 포함 인원 수, 같은 부서 다시 추가는 역할 덮어쓰기), 목록, 역할 변경 200, 제거 204. 없는
   * 부서 행의 변경·제거는 404. 변경마다 공간 변경 알림이 나가고, 제거는 빠지기 전 실효 멤버를 추가 수신자로 넘긴다.
   */
  @Test
  void member_groups_crud_and_notifications() throws Exception {
    // AI 는 세지 않는다 — 직속 사람 1 + 하위 부서 사람 1 = 2명. 두 부서에 겹친 사람은 한 번.
    member(devId, createAgentUserWithMembership("dept-agent"));
    member(devId, backendMemberId);
    appEvents.clear();

    JsonNode added = json(addGroup(devId, "EDITOR").andExpect(status().isCreated()));
    assertThat(added.get("groupId").asLong()).isEqualTo(devId);
    assertThat(added.get("name").asText()).isEqualTo("개발팀-" + suffix);
    assertThat(added.get("role").asText()).isEqualTo("EDITOR");
    assertThat(added.get("memberCount").asInt()).isEqualTo(2);
    assertThat(spaceChanges()).hasSize(1);

    // 같은 부서를 다시 더하면 역할을 덮어쓴다(사람 멤버 추가와 같은 업서트).
    addGroup(devId, "VIEWER")
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.role").value("VIEWER"));
    addGroup(backendId, "EDITOR").andExpect(status().isCreated());

    JsonNode list =
        json(
            call(get("/api/v1/drive/spaces/{id}/member-groups", spaceId), ownerId)
                .andExpect(status().isOk()));
    assertThat(list).hasSize(2);
    JsonNode backend = matchingGroup(list, backendId);
    assertThat(backend.get("role").asText()).isEqualTo("EDITOR");
    assertThat(backend.get("memberCount").asInt()).isEqualTo(1);
    assertThat(matchingGroup(list, devId).get("role").asText()).isEqualTo("VIEWER");

    changeGroup(devId, "EDITOR")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.groupId").value(devId))
        .andExpect(jsonPath("$.role").value("EDITOR"))
        .andExpect(jsonPath("$.memberCount").value(2));

    // 실효 멤버(실시간 알림 수신자) — 직접 OWNER + 부서·하위 부서 구성원, 중복 없이.
    assertThat(audience.resolve(spaceId))
        .containsExactlyInAnyOrder(ownerId, devMemberId, backendMemberId);

    appEvents.clear();
    call(delete("/api/v1/drive/spaces/{id}/member-groups/{g}", spaceId, devId), ownerId)
        .andExpect(status().isNoContent());
    // 개발팀으로만 들어와 있던 사람도 빠지기 전 명단으로 알림을 받는다.
    assertThat(spaceChanges())
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.op()).isEqualTo(ResourceChangedEvent.OP_UPDATED);
              assertThat(e.actorId()).isEqualTo(ownerId);
              assertThat(e.extraRecipients()).contains(devMemberId, backendMemberId, ownerId);
            });
    assertThat(audience.resolve(spaceId)).containsExactlyInAnyOrder(ownerId, backendMemberId);

    call(delete("/api/v1/drive/spaces/{id}/member-groups/{g}", spaceId, devId), ownerId)
        .andExpect(status().isNotFound());
    changeGroup(devId, "VIEWER").andExpect(status().isNotFound());
  }

  /** 부서 구성원 감소(사람을 부서에서 뺌)는 부서를 멤버로 둔 공간마다 변경 알림을 내고, 바뀌기 전 실효 멤버(빠지는 사람 포함)를 추가 수신자로 넘긴다. */
  @Test
  void department_member_reduction_notifies_before_change_audience() throws Exception {
    TestFixtures.grantRole(dsl, ownerId, "ADMIN"); // 조직도 쓰기 권한
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    long otherSpace = spaceService.createTeamSpace(ownerId, "다른공간-" + suffix).id();
    appEvents.clear();

    groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);

    List<ResourceChangedEvent> events = spaceChanges();
    assertThat(events)
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.scopeId()).isEqualTo(spaceId);
              assertThat(e.actorId()).isNull();
              assertThat(e.extraRecipients()).contains(backendMemberId, devMemberId, ownerId);
            });
    assertThat(events).noneMatch(e -> e.scopeId() == otherSpace);
    // 커밋 직전 수신자 조회에서는 빠진 사람이 없다 — 그래서 추가 수신자로 넘겨야 한다.
    assertThat(audience.resolve(spaceId)).doesNotContain(backendMemberId);
  }

  /**
   * 부서 구성원 증가(WP-1102) — 하위 부서에 사람을 넣거나 다른 부서를 그 아래로 옮겨 오면, 그 부서(또는 상위 부서)를 멤버로 둔 공간마다 행위자 없는 변경
   * 알림이 나가고 새로 들어온 사람이 커밋 직전 수신자 조회에 들어 있다. 부서와 무관한 공간에는 알림이 없다.
   */
  @Test
  void department_member_growth_notifies_new_member() throws Exception {
    TestFixtures.grantRole(dsl, ownerId, "ADMIN"); // 조직도 쓰기 권한
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    long otherSpace = spaceService.createTeamSpace(ownerId, "다른공간-" + suffix).id();
    long newcomerId = human();
    appEvents.clear();

    // 개발팀의 하위 부서(백엔드)에 사람을 넣는다 — 개발팀을 멤버로 둔 공간에 들어온다.
    groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", newcomerId));

    assertThat(spaceChanges())
        .singleElement()
        .satisfies(
            e -> {
              assertThat(e.scopeId()).isEqualTo(spaceId);
              assertThat(e.actorId()).isNull();
            });
    assertThat(spaceChanges()).noneMatch(e -> e.scopeId() == otherSpace);
    assertThat(audience.resolve(spaceId)).contains(newcomerId);

    // 이미 구성원인 사람을 다시 넣으면(멱등) 아무도 늘지 않아 알리지 않는다.
    appEvents.clear();
    groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", newcomerId));
    assertThat(spaceChanges()).isEmpty();

    // 다른 부서를 백엔드 아래로 옮겨 오면 그 구성원도 들어온다.
    long movedMemberId = human();
    long qaId = group("QA-" + suffix, "SHARED", null, null);
    member(qaId, movedMemberId);
    appEvents.clear();

    groupService.update(
        ownerId, qaId, new UpdateUserGroupRequest(null, backendId, null, null, null, null));

    assertThat(spaceChanges())
        .singleElement()
        .satisfies(e -> assertThat(e.scopeId()).isEqualTo(spaceId));
    assertThat(audience.resolve(spaceId)).contains(movedMemberId);

    // 같은 상위(개발팀) 안에서 백엔드 → 개발팀 바로 아래로 옮기면 개발팀 구성원은 그대로다 — 개발팀을 멤버로 둔 공간에는 알림이 없다.
    appEvents.clear();
    groupService.update(
        ownerId, qaId, new UpdateUserGroupRequest(null, devId, null, null, null, null));
    assertThat(spaceChanges()).isEmpty();
    assertThat(audience.resolve(spaceId)).contains(movedMemberId);
  }

  /** 부서를 지우면 멤버 부서 행도 사라지고(CASCADE) 그 구성원은 더 열 수 없다. */
  @Test
  void deleting_department_removes_row() throws Exception {
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    call(get("/api/v1/drive/spaces/{id}/items", spaceId), devMemberId).andExpect(status().isOk());

    dsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.eq(devId)).execute();

    assertThat(dsl.fetchCount(DRIVE_SPACE_MEMBER_GROUP)).isZero();
    call(get("/api/v1/drive/spaces/{id}/items", spaceId), devMemberId)
        .andExpect(status().isNotFound());
  }

  /** 부서로만 들어온 공간도 내 목록에 보이므로, 같은 이름의 팀 공간을 새로 만들 수 없다(볼 수 있는 공간끼리의 이름 충돌, WP-693). */
  @Test
  void visible_name_collision_includes_department_spaces() throws Exception {
    addGroup(devId, "VIEWER").andExpect(status().isCreated());
    call(
            post("/api/v1/drive/spaces")
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(Map.of("name", "부서멤버-" + suffix))),
            backendMemberId)
        .andExpect(status().isConflict());
  }

  /** 콘텐츠 검색 — 부서로만 들어온 사람도 파일을 찾고, 직접·부서 양쪽에 걸린 사람에게도 파일이 한 번만 나온다(키워드·벡터 경로 모두). */
  @Test
  void content_search_finds_department_files_without_duplicates() throws Exception {
    spaceService.addMember(ownerId, spaceId, devMemberId, "VIEWER");
    addGroup(devId, "EDITOR").andExpect(status().isCreated());
    long fileId = seedDriveFileWithExtraction("분기 매출 " + suffix);

    for (long user : List.of(devMemberId, backendMemberId)) {
      for (float[] vec : new float[][] {null, {0.1f, 0.2f, 0.3f}}) {
        List<ContentRow> hits = contentSearch.hybridSearch(user, suffix, vec, 10, null);
        assertThat(hits).filteredOn(h -> h.driveFileId() == fileId).hasSize(1);
        assertThat(contentSearch.hybridSearch(user, suffix, vec, 10, spaceId))
            .filteredOn(h -> h.driveFileId() == fileId)
            .hasSize(1);
      }
    }
    assertThat(contentSearch.hybridSearch(strangerId, suffix, null, 10, null))
        .noneMatch(h -> h.driveFileId() == fileId);
  }

  // ── 도우미 ─────────────────────────────────────────────────────────────

  /** 공간 변경 알림(resource drive-space, 이 테스트의 공간들) — 발행 순서대로. */
  private List<ResourceChangedEvent> spaceChanges() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(e -> DriveChangeNotifier.RESOURCE_DRIVE_SPACE.equals(e.resource()))
        .toList();
  }

  private static List<JsonNode> matching(JsonNode spaces, long id) {
    List<JsonNode> out = new ArrayList<>();
    spaces.forEach(
        s -> {
          if (s.get("id").asLong() == id) out.add(s);
        });
    return out;
  }

  private static JsonNode matchingGroup(JsonNode groups, long groupId) {
    for (JsonNode g : groups) {
      if (g.get("groupId").asLong() == groupId) return g;
    }
    throw new AssertionError("부서 " + groupId + " 가 목록에 없다");
  }

  private MockHttpServletRequestBuilder addGroupReq(long space, long groupId, String role)
      throws Exception {
    return post("/api/v1/drive/spaces/{id}/member-groups", space)
        .contentType(MediaType.APPLICATION_JSON)
        .content(om.writeValueAsString(Map.of("groupId", groupId, "role", role)));
  }

  private ResultActions addGroup(long groupId, String role) throws Exception {
    return call(addGroupReq(spaceId, groupId, role), ownerId);
  }

  private MockHttpServletRequestBuilder patchGroup(long groupId, String role) throws Exception {
    return patch("/api/v1/drive/spaces/{id}/member-groups/{g}", spaceId, groupId)
        .contentType(MediaType.APPLICATION_JSON)
        .content(om.writeValueAsString(Map.of("role", role)));
  }

  private ResultActions changeGroup(long groupId, String role) throws Exception {
    return call(patchGroup(groupId, role), ownerId);
  }

  private ResultActions createFolder(long userId) throws Exception {
    return call(
        post("/api/v1/drive/spaces/{id}/folders", spaceId)
            .contentType(MediaType.APPLICATION_JSON)
            .content(
                om.writeValueAsString(
                    Map.of("name", "폴더-" + UUID.randomUUID().toString().substring(0, 8)))),
        userId);
  }

  /**
   * file → drive_file → file_extraction(DONE) 시드 — 콘텐츠 검색 대상 파일(DriveContentSearchRepositoryTest 와
   * 같은 방식).
   */
  private long seedDriveFileWithExtraction(String extractedText) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, "보고서-" + s)
            .set(FILE.STORED_NAME, "stored_" + s)
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 100L)
            .set(FILE.STORAGE_PATH, "/data/uploads/" + s)
            .set(FILE.UPLOADED_BY, ownerId)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, "보고서-" + s)
        .execute();
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, fileId)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, extractedText)
        .set(FILE_EXTRACTION.TENANT_ID, 1L)
        .execute();
    return dsl.select(DRIVE_FILE.ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.FILE_ID.eq(fileId))
        .fetchOne(DRIVE_FILE.ID);
  }

  private long human() {
    return withMembership(TestFixtures.createHuman(dsl));
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
