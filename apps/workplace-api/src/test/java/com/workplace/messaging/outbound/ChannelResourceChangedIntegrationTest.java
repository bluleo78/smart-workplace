package com.workplace.messaging.outbound;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.messaging.service.DmService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-62 통합 — 채널·멤버십·DM 변경 → AFTER_COMMIT resource.changed 수신자 검증. AFTER_COMMIT 발화를 위해
 * 클래스에 @Transactional 을 붙이지 않는다.
 */
@DisplayName("채널·DM 변경 → resource.changed fan-out 통합")
class ChannelResourceChangedIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;

  @Autowired DSLContext dsl;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberService channelMemberService;
  @Autowired DmService dmService;

  private final List<Long> createdUserIds = new ArrayList<>();
  private Long owner;
  private Long member;
  private Long outsider;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    owner = createHuman("owner");
    member = createHuman("member");
    outsider = createHuman("outsider");
  }

  @AfterEach
  void cleanup() {
    dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(createdUserIds)).execute();
    dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
    dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    createdUserIds.clear();
    TenantContext.clear();
  }

  /** resource/op 조합의 resource.changed 를 캡처해 (수신자, payload) 로 돌려준다. */
  @SuppressWarnings("unchecked")
  private Captured capture(String resource, String op) {
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000).atLeastOnce())
        .fanOut(ids.capture(), eq("resource.changed"), payload.capture());
    for (int i = 0; i < payload.getAllValues().size(); i++) {
      var p = (Map<String, Object>) payload.getAllValues().get(i);
      if (resource.equals(p.get("resource")) && op.equals(p.get("op"))) {
        return new Captured(ids.getAllValues().get(i), p);
      }
    }
    throw new AssertionError("resource.changed " + resource + "/" + op + " 미수신");
  }

  private record Captured(Collection<Long> recipients, Map<String, Object> payload) {}

  private ChannelResponse newChannel(String visibility) {
    return channelService.create(owner, "rc-" + UUID.randomUUID(), visibility);
  }

  @Test
  @DisplayName("공개 채널 생성은 같은 테넌트 비멤버에게도")
  void publicCreate_reachesTenantNonMember() {
    clearInvocations(registry);
    newChannel("PUBLIC");
    assertThat(capture("channel", "created").recipients()).contains(owner, outsider);
  }

  @Test
  @DisplayName("비공개 채널 생성은 비멤버 제외")
  void privateCreate_doesNotReachNonMember() {
    clearInvocations(registry);
    newChannel("PRIVATE");
    var rec = capture("channel", "created").recipients();
    assertThat(rec).contains(owner).doesNotContain(outsider);
  }

  @Test
  @DisplayName("비공개 채널 이름 변경은 멤버에게만")
  void privateRename_reachesMembersOnly() {
    var ch = newChannel("PRIVATE");
    channelMemberService.add(owner, ch.id(), member);
    clearInvocations(registry);
    channelService.rename(owner, ch.id(), "rc-renamed-" + UUID.randomUUID());
    var rec = capture("channel", "updated").recipients();
    assertThat(rec).contains(owner, member).doesNotContain(outsider);
  }

  @Test
  @DisplayName("멤버 제거 알림은 제거된 사용자도 받는다")
  void memberRemove_reachesRemovedUser() {
    var ch = newChannel("PRIVATE");
    channelMemberService.add(owner, ch.id(), member);
    clearInvocations(registry);
    channelMemberService.remove(owner, ch.id(), member);
    assertThat(capture("channel", "updated").recipients()).contains(owner, member);
  }

  @Test
  @DisplayName("나가기 알림은 나간 사용자도 받는다")
  void leave_reachesLeaver() {
    var ch = newChannel("PRIVATE");
    channelMemberService.add(owner, ch.id(), member);
    clearInvocations(registry);
    channelMemberService.leave(member, ch.id());
    assertThat(capture("channel", "updated").recipients()).contains(owner, member);
  }

  @Test
  @DisplayName("비공개 채널 하드 삭제는 삭제 전 멤버에게")
  void privateHardDelete_reachesMembersCollectedBefore() {
    var ch = newChannel("PRIVATE");
    channelMemberService.add(owner, ch.id(), member);
    Long admin = createHuman("admin");
    Long adminRole = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, admin)
        .set(USER_ROLE.ROLE_ID, adminRole)
        .execute();
    clearInvocations(registry);
    channelService.hardDelete(admin, ch.id());
    var rec = capture("channel", "deleted").recipients();
    assertThat(rec).contains(owner, member).doesNotContain(outsider);
  }

  @Test
  @DisplayName("DM 생성은 DM 멤버 전원에게")
  void dmCreate_reachesAllDmMembers() {
    withMembership(owner);
    withMembership(member);
    clearInvocations(registry);
    dmService.createOrGet(owner, List.of(member));
    assertThat(capture("dm", "created").recipients()).contains(owner, member);
  }

  @Test
  @DisplayName("기존 DM 재조회는 발행하지 않는다")
  void dmGetExisting_publishesNothing() {
    withMembership(owner);
    withMembership(member);
    dmService.createOrGet(owner, List.of(member));
    clearInvocations(registry);
    var second = dmService.createOrGet(owner, List.of(member));
    assertThat(second.created()).isFalse();
    verify(registry, after(500).never()).fanOut(any(), eq("resource.changed"), any());
  }

  @Test
  @DisplayName("payload 에 채널명을 싣지 않는다")
  void payloadHasNoChannelName() {
    clearInvocations(registry);
    newChannel("PRIVATE");
    assertThat(capture("channel", "created").payload().keySet())
        .doesNotContain("name", "channelName");
  }

  private Long createHuman(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    createdUserIds.add(id);
    withMembership(id);
    return id;
  }
}
