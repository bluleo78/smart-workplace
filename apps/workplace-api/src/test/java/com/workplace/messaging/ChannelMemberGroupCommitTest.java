package com.workplace.messaging;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.ResourceSseDispatcher;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.service.ChannelMemberGroupService;
import com.workplace.messaging.service.ChannelMemberGroupSync;
import com.workplace.messaging.service.ChannelMemberService;
import com.workplace.messaging.service.ChannelService;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.service.UserGroupService;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 채널 멤버 부서(WP-1058)의 조직도 변경 맞추기를 실제 커밋으로 검증한다 — 부서 구성원 감소 이벤트는 변경 전에 나와 맞추기가 커밋 직전 리스너에서 돌고, 그 안에서
 * 낸 SSE 알림은 디스패처에 닿지 않는다. 그래서 알림은 요청 흐름에서 미리 내고 맞추기를 디스패처보다 먼저 돌린다 — 롤백 테스트({@link
 * ChannelMemberGroupTest})는 커밋 직전 리스너를 직접 불러 이 연결을 보지 못하므로 여기서 본다.
 *
 * <p>비-@Transactional(커밋): 시드·호출은 {@link #callInTenant} 트랜잭션으로 커밋하고 끝나면 채널(CASCADE)·부서·사람을 회수한다.
 * SSE 는 목(SseRegistry)으로 전송 대상만 잡는다.
 */
class ChannelMemberGroupCommitTest extends ExternalClientMockedTestBase {

  private static final long TENANT = 1L;

  @Autowired DSLContext dsl;
  @Autowired SseRegistry registry;
  @Autowired ChannelService channelService;
  @Autowired ChannelMemberGroupService memberGroupService;
  @Autowired ChannelMemberRepository memberRepo;
  @Autowired UserGroupService groupService;
  @Autowired ChannelMemberService channelMemberService;
  @Autowired ChannelMemberGroupSync sync;

  private final List<Long> users = new ArrayList<>();
  private final List<Long> groups = new ArrayList<>();
  private long ownerId;
  private long devMemberId;
  private long backendMemberId;
  private long devId;
  private long backendId;
  private long channelId;

  @BeforeEach
  void seed() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    callInTenant(
        TENANT,
        () -> {
          ownerId = human();
          TestFixtures.grantRole(dsl, ownerId, "ADMIN"); // 조직도 쓰기 권한
          devMemberId = human();
          backendMemberId = human();
          devId = group("개발팀-" + suffix, null);
          backendId = group("백엔드-" + suffix, devId);
          member(devId, devMemberId);
          member(backendId, backendMemberId);
          channelId = channelService.create(ownerId, "부서커밋-" + suffix, "PRIVATE").id();
          memberGroupService.add(ownerId, channelId, devId);
          return null;
        });
    clearInvocations(registry);
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        TENANT,
        () -> {
          dsl.deleteFrom(CHANNEL).where(CHANNEL.CREATED_BY.in(users)).execute();
          dsl.deleteFrom(USER_GROUP_MEMBER)
              .where(USER_GROUP_MEMBER.TARGET_TYPE.eq("MEMBER"))
              .and(USER_GROUP_MEMBER.TARGET_ID.in(users))
              .execute();
          dsl.deleteFrom(USER_GROUP).where(USER_GROUP.ID.in(groups)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(users)).execute();
        });
  }

  /** 부서에서 빠진 사람은 커밋과 함께 채널에서 빠지고, 그 사람에게도 채널 변경 SSE 가 간다. */
  @Test
  void leaving_department_commits_removal_and_notifies_leaver() {
    callInTenant(
        TENANT,
        () -> {
          groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);
          return null;
        });

    assertThat(isMember(backendMemberId)).isFalse();
    assertThat(isMember(devMemberId)).isTrue();
    assertThat(channelRecipients()).contains(backendMemberId, devMemberId, ownerId);
  }

  /** 부서를 지우면 커밋과 함께 그 부서로만 들어와 있던 사람이 빠진다(부서 행은 CASCADE). */
  @Test
  void deleting_department_commits_removal() {
    callInTenant(
        TENANT,
        () -> {
          groupService.delete(ownerId, backendId);
          return null;
        });

    assertThat(isMember(backendMemberId)).isFalse();
    assertThat(channelRecipients()).contains(backendMemberId);
  }

  /** 나중에 부서에 들어온 사람은 커밋과 함께 채널에 들어오고 채널 변경 SSE 를 받는다. */
  @Test
  void joining_department_commits_row_and_notifies_newcomer() {
    long newcomer = callInTenant(TENANT, this::human);
    callInTenant(
        TENANT,
        () -> {
          groupService.addMember(ownerId, backendId, new AddMemberRequest("MEMBER", newcomer));
          return null;
        });

    assertThat(isMember(newcomer)).isTrue();
    assertThat(channelRecipients()).contains(newcomer);
  }

  /**
   * 부서 추가와 내보내기가 겹쳐도 내보낸 사람이 다시 들어오지 않는다(WP-1186) — 부서 추가 트랜잭션이 커밋되기 전에 그 부서 사람을 내보내면, 예전에는 내보내기가
   * 커밋되지 않은 부서를 보지 못해 개인 제외를 남기지 않았고 다음 맞추기가 그 사람을 다시 넣었다. 이제 내보내기는 채널 잠금을 기다렸다가 부서를 본다.
   */
  @Test
  void kick_during_uncommitted_department_add_keeps_member_out() throws Exception {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long[] ids = new long[2];
    callInTenant(
        TENANT,
        () -> {
          ids[0] = human();
          ids[1] = group("기획팀-" + suffix, null);
          member(ids[1], ids[0]);
          channelMemberService.add(ownerId, channelId, ids[0]); // 직접 멤버로 먼저 있다
          return null;
        });
    long planner = ids[0];
    long planId = ids[1];

    CountDownLatch added = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    CompletableFuture<Void> addTx =
        CompletableFuture.runAsync(
            () ->
                callInTenant(
                    TENANT,
                    () -> {
                      memberGroupService.add(ownerId, channelId, planId);
                      added.countDown();
                      await(release); // 부서 추가를 커밋하지 않은 채 쥔다
                      return null;
                    }));
    assertThat(added.await(10, TimeUnit.SECONDS)).isTrue();
    CompletableFuture<Void> kick =
        CompletableFuture.runAsync(
            () ->
                callInTenant(
                    TENANT,
                    () -> {
                      channelMemberService.remove(ownerId, channelId, planner);
                      return null;
                    }));
    // 잠금이 있으면 내보내기는 부서 추가가 커밋될 때까지 기다린다 — 잠시 두고 놓아준다(없으면 그사이 먼저 끝난다).
    try {
      kick.get(1, TimeUnit.SECONDS);
    } catch (TimeoutException expected) {
      // 기다리는 중
    }
    release.countDown();
    addTx.get(10, TimeUnit.SECONDS);
    kick.get(10, TimeUnit.SECONDS);

    callInTenant(TENANT, () -> sync.reconcile(channelId));
    assertThat(isMember(planner)).isFalse();
  }

  /** 부서에서 빠졌어도 채널에서 빠진 사람이 없으면(직접 멤버) 채널 멤버십 SSE 를 내지 않는다(WP-1186 — 예전에는 관련 채널 멤버 전원에게 냈다). */
  @Test
  void department_shrink_without_channel_change_sends_no_channel_sse() {
    callInTenant(
        TENANT,
        () -> {
          channelMemberService.add(ownerId, channelId, backendMemberId); // 직접 멤버로 고정
          return null;
        });
    clearInvocations(registry);

    callInTenant(
        TENANT,
        () -> {
          groupService.removeMember(ownerId, backendId, "MEMBER", backendMemberId);
          return null;
        });

    assertThat(isMember(backendMemberId)).isTrue();
    assertThat(channelFanOuts()).isZero();
  }

  /** 사람 행이 그대로여도 멤버 부서를 지워 부서 행이 사라졌으면 열린 멤버 창이 다시 받게 채널 SSE 를 낸다(WP-1186). */
  @Test
  void deleting_department_of_direct_members_still_notifies_group_change() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long[] ids = new long[2];
    callInTenant(
        TENANT,
        () -> {
          ids[0] = human();
          ids[1] = group("QA-" + suffix, null);
          member(ids[1], ids[0]);
          memberGroupService.add(ownerId, channelId, ids[1]);
          channelMemberService.add(ownerId, channelId, ids[0]); // 직접 멤버로 고정
          return null;
        });
    clearInvocations(registry);

    callInTenant(
        TENANT,
        () -> {
          groupService.delete(ownerId, ids[1]);
          return null;
        });

    assertThat(isMember(ids[0])).isTrue();
    assertThat(channelFanOuts()).isEqualTo(1);
  }

  // --- 헬퍼 ---

  private static void await(CountDownLatch latch) {
    try {
      latch.await(10, TimeUnit.SECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  /** 이 채널의 resource.changed(channel) 전송 횟수. */
  @SuppressWarnings("unchecked")
  private long channelFanOuts() {
    return mockingDetails(registry).getInvocations().stream()
        .filter(inv -> inv.getMethod().getName().equals("fanOut"))
        .map(inv -> (Map<String, Object>) inv.getArgument(2))
        .filter(
            p ->
                "channel".equals(p.get("resource"))
                    && ((Collection<?>) p.get("ids")).contains(channelId))
        .count();
  }

  /** 이 채널의 resource.changed(channel) 전송 대상 전부(여러 번 보냈으면 합친다). */
  @SuppressWarnings("unchecked")
  private List<Long> channelRecipients() {
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, atLeastOnce())
        .fanOut(ids.capture(), eq(ResourceSseDispatcher.EVENT_NAME), payload.capture());
    List<Long> recipients = new ArrayList<>();
    for (int i = 0; i < ids.getAllValues().size(); i++) {
      Map<String, Object> p = (Map<String, Object>) payload.getAllValues().get(i);
      if ("channel".equals(p.get("resource"))
          && ((Collection<?>) p.get("ids")).contains(channelId)) {
        recipients.addAll(ids.getAllValues().get(i));
      }
    }
    return recipients;
  }

  private boolean isMember(long userId) {
    return callInTenant(TENANT, () -> memberRepo.isMember(channelId, userId));
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    grantUserRole(id);
    users.add(id);
    return id;
  }

  private long group(String name, Long parentId) {
    long id =
        dsl.insertInto(USER_GROUP)
            .set(USER_GROUP.NAME, name)
            .set(USER_GROUP.VISIBILITY, "SHARED")
            .set(USER_GROUP.PARENT_ID, parentId)
            .returning(USER_GROUP.ID)
            .fetchOne()
            .getId();
    groups.add(id);
    return id;
  }

  private void member(long groupId, long userId) {
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, groupId)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, userId)
        .execute();
  }
}
