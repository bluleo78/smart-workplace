package com.workplace.messaging.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.messaging.dto.ChannelMemberGroupResponse;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelMemberGroupDuplicatedException;
import com.workplace.messaging.exception.ChannelMemberGroupNotFoundException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.outbound.ChannelChangeNotifier;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelArchivedEvent;
import com.workplace.messaging.repository.ChannelMemberGroupRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.ChannelRepository.ChannelState;
import com.workplace.messaging.service.ChannelMemberGroupSync.Diff;
import com.workplace.user.outbound.DepartmentMembersGrown;
import com.workplace.user.outbound.DepartmentMembersReduced;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 비공개 채널 멤버로 둔 조직도 부서(WP-1058) — 부서 자체를 채널 멤버로 둔다. 그 부서와 하위 부서의 활성 사람 구성원이 MEMBER 로 채널에 들어오고, 나중에
 * 부서에 들어온 사람은 들어오고 빠진 사람은 빠진다. 노트·드라이브·프로젝트(WP-1052·1056·1057)와 달리 사람 행을 channel_member 에 펼쳐 둔다 —
 * 채널 멤버 행을 직접 읽는 쿼리(안 읽은 수·내 채널·멘션·SSE 수신자·연동 드라이브 명단)가 그대로 돌게. 맞추기는 {@link ChannelMemberGroupSync}
 * 가 한다.
 *
 * <p>규칙: 비공개 채널(kind=CHANNEL, PRIVATE)에만(공개 채널은 누구나 참여, DM 은 참여자 고정), 조직도 부서(SHARED)만, 역할은 MEMBER
 * 고정(멤버 관리 권한은 사람에게만). 권한은 사람 멤버 API 와 같다 — 조회는 채널을 읽을 수 있는 사람, 변경은 OWNER/ADMIN(시스템 ADMIN 포함). 이미 둔
 * 부서를 다시 더하면 409(프로젝트 멤버 부서와 같다).
 *
 * <p>맞추는 때: 부서 행 추가·제거(바로), 조직도 부서 구성원 증가({@link DepartmentMembersGrown} — 변경 뒤 발행이라 바로, 정지 해제 포함),
 * 감소·부서 삭제/이동({@link DepartmentMembersReduced} — 변경 전 발행이라 커밋 직전), 채널 보관 해제({@link
 * ChannelArchivedEvent}). 사람 행이 바뀐 때만 초대·내보내기와 같은 경로로 알린다(부서 행 추가·제거는 부서 목록이 바뀌었으므로 늘 한 번 알린다). 구성원
 * 정지는 맞추지 않는다 — 정지가 이미 접근을 막고, 부서 사람 행을 남겨 두어야 정지를 풀었을 때 읽은 위치·가입 시각이 그대로다.
 */
@Service
@RequiredArgsConstructor
public class ChannelMemberGroupService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberGroupRepository groups;
  private final ChannelPermissions perms;
  private final ChannelMemberGroupSync sync;
  private final ChannelRosterPublisher rosterPublisher;
  private final ChannelChangeNotifier changeNotifier;
  private final ApplicationEventPublisher publisher;

  /** 채널 멤버 부서 목록(이름순, 부서마다 들어오는 사람 수) — 사람 멤버 목록과 같이 채널을 읽을 수 있으면 볼 수 있다. 그 밖의 비멤버는 404 은닉. */
  @Transactional(readOnly = true)
  public List<ChannelMemberGroupResponse> list(long callerId, long channelId) {
    ensureExists(channelId);
    if (!perms.canRead(channelId, callerId)) throw new ChannelNotFoundException(channelId);
    return groups.list(channelId);
  }

  /**
   * 조직도 부서를 채널 멤버로 더하고 그 부서 사람을 채널에 넣는다(OWNER/ADMIN).
   *
   * @throws IllegalArgumentException DM·공개 채널, 조직도 부서가 아닌 그룹(개인 그룹·없는 그룹·다른 워크스페이스) — 400
   * @throws ChannelArchivedException 보관된 채널 — 409(초대와 같다)
   * @throws ChannelMemberGroupDuplicatedException 이미 멤버인 부서 — 409
   */
  @Transactional
  public ChannelMemberGroupResponse add(long callerId, long channelId, long groupId) {
    // 존재·종류·공개 범위·보관 여부를 한 번에 읽는다.
    ChannelState state =
        channelRepo.findState(channelId).orElseThrow(() -> new ChannelNotFoundException(channelId));
    // DM 은 참여자도 관리 역할이 없어(MEMBER) 권한 검사가 먼저면 403 이 된다 — 읽을 수 있는 사람(참여자·시스템 ADMIN)에게는 이유(400)로,
    // 그 밖의 사람에게는 없는 채널(404)로 답한다(WP-511 존재 은닉).
    if ("DM".equals(state.kind())) {
      rejectDm(callerId, channelId);
    }
    // 권한 먼저 — 비공개 비멤버는 여기서 404 로 존재를 숨긴다(WP-511).
    perms.requireManage(channelId, callerId, "add-member-group");
    // 부서는 비공개 채널에만 둔다 — 공개 채널은 누구나 참여한다(DM 은 위에서 걸렀다 — 참여자가 생성 때 고정).
    if (!"PRIVATE".equals(state.visibility())) {
      throw new IllegalArgumentException("비공개 채널에만 부서를 멤버로 둘 수 있습니다");
    }
    if (state.archived()) {
      throw new ChannelArchivedException(channelId, "보관된 채널에는 부서를 멤버로 둘 수 없습니다");
    }
    // 넣기 전에 채널 행을 잠근다(권한 검사 뒤) — 들어올 사람을 읽고 넣는 사이 내보내기·나가기가 끼어들면, 그쪽은 아직 커밋되지 않은 이 부서를 보지 못해
    // 개인 제외를 남기지 않아 내보낸 사람이 다음 맞추기로 다시 들어왔다(WP-1186). 잠금은 커밋까지 쥔다.
    channelRepo.lockState(channelId);
    // 노트·드라이브·프로젝트 멤버 부서와 같은 검증·문구 — 개인 그룹은 조건으로, 다른 워크스페이스 그룹은 RLS 로 빠진다.
    String name =
        groups
            .findDepartmentName(groupId)
            .orElseThrow(() -> new IllegalArgumentException("조직도 부서만 지정할 수 있습니다"));
    Instant addedAt =
        groups
            .insert(channelId, groupId, callerId)
            .orElseThrow(ChannelMemberGroupDuplicatedException::new);
    // 부서를 더해도 걸리지 않게 되는 사람은 없다 — 빼기 없이 이 부서로 들어올 사람만 넣는다. 하위 부서 트리를 한 번만 펼쳐 넣을 사람과 응답의
    // 인원 수에 함께 쓴다(이미 직접 멤버인 사람도 인원에는 든다).
    List<Long> incoming = groups.findIncomingUserIds(channelId, groupId);
    announceGroupChange(
        channelId, callerId, new Diff(groups.insertGroupMembers(channelId, incoming), List.of()));
    return new ChannelMemberGroupResponse(groupId, name, incoming.size(), addedAt);
  }

  /**
   * 멤버 부서를 빼고 그 부서로만 들어와 있던 사람을 채널에서 뺀다(OWNER/ADMIN). 직접 멤버·관리자와 다른 멤버 부서로 여전히 걸리는 사람은 남는다(읽은 위치
   * 그대로). 이제 어느 멤버 부서에도 걸리지 않는 사람의 개인 제외는 지운다 — 나중에 그 사람이 걸리는 부서를 더하면 다시 들어올 수 있게(남은 부서로 여전히 걸리면
   * 제외는 그대로). 보관된 채널에서도 뺄 수 있다 — 내보내기와 같은 정리용.
   *
   * @throws ChannelMemberGroupNotFoundException 이 채널의 멤버 부서가 아님 — 404
   */
  @Transactional
  public void remove(long callerId, long channelId, long groupId) {
    ChannelState state =
        channelRepo.findState(channelId).orElseThrow(() -> new ChannelNotFoundException(channelId));
    // DM 은 더하기와 같게 답한다 — 참여자는 관리 역할이 없어 권한 검사가 먼저면 403 이 됐다(더하기는 400, WP-1186).
    if ("DM".equals(state.kind())) {
      rejectDm(callerId, channelId);
    }
    perms.requireManage(channelId, callerId, "remove-member-group");
    // 채널 행을 잠가 초대·내보내기와 줄 세운다(WP-1186, 권한 검사 뒤).
    channelRepo.lockState(channelId);
    if (groups.delete(channelId, groupId) == 0) {
      throw new ChannelMemberGroupNotFoundException();
    }
    groups.deleteUncoveredExclusions(channelId);
    // 부서를 빼도 새로 들어올 사람은 없다 — 이제 걸리지 않는 부서 사람 행만 뺀다.
    announceGroupChange(
        channelId, callerId, new Diff(List.of(), groups.deleteUncovered(channelId)));
  }

  /**
   * 부서 행을 더하거나 뺀 뒤 알린다 — 부서 목록·인원이 바뀌었으므로 들고 나는 사람이 없어도(모두 직접 멤버 등) 채널 멤버십 변경 알림(SSE)을 한 번 낸다. 열어 둔
   * 다른 관리자의 멤버 창이 부서 목록을 바로 다시 받게. roster 이벤트는 사람 행이 바뀐 때만 낸다.
   */
  private void announceGroupChange(long channelId, long callerId, Diff diff) {
    if (diff.changed()) {
      rosterPublisher.publish(channelId);
    }
    changeNotifier.membershipChanged(channelId, callerId, diff.removed());
  }

  /**
   * 사람 행이 바뀌었으면 초대·내보내기와 같은 경로로 알린다 — roster 이벤트({@link ChannelRosterPublisher} → 연동 드라이브 공간 명단)와
   * 채널 멤버십 변경 알림(SSE, 빠진 사람은 커밋 뒤 명단에 없으므로 추가 수신자로). 바뀐 것이 없으면 아무것도 내지 않는다.
   *
   * @param actorId 바꾼 사람 — 조직도 변경·보관 해제에서 왔으면 null
   */
  private void announce(long channelId, Long actorId, Diff diff) {
    if (!diff.changed()) {
      return;
    }
    rosterPublisher.publish(channelId);
    changeNotifier.membershipChanged(channelId, actorId, diff.removed());
  }

  /**
   * 조직도 부서의 구성원이 늘었다(WP-1058 이벤트) — 그 부서(이벤트에 상위 부서도 담겨 온다)를 멤버로 둔 채널마다 새로 들어올 사람을 넣는다. 늘었을 뿐이라 빼기는
   * 하지 않고, 늘어난 사람이 정해져 있으면(부서에 넣은 사람·정지가 풀린 사람) 그 사람만 본다. 변경 뒤 같은 트랜잭션에서 발행되므로 바로 넣고, 실제로 들어온 사람이
   * 있는 채널만 초대와 같이 알린다(이미 들어와 있거나 정지·제외된 사람이면 조용하다). 테넌트는 이벤트에 담긴 값으로 세운다.
   */
  @EventListener
  public void onDepartmentMembersGrown(DepartmentMembersGrown e) {
    TenantContext.runAs(
        e.tenantId(),
        () -> {
          for (long channelId : groups.findChannelIdsByGroups(e.groupIds())) {
            announce(channelId, null, sync.addGrown(channelId, e.userIds()));
          }
        });
  }

  /**
   * 조직도 부서의 구성원이 줄었거나 부서가 사라졌다(WP-1042 이벤트) — 동기 리스너라 변경 <b>전</b>(같은 트랜잭션)에 돈다. 부서를 지우면 멤버 부서 행이
   * CASCADE 로 사라지므로 영향받는 채널을 여기서 모으고, 맞추기는 변경이 반영된 뒤(커밋 직전) {@link #onDepartmentAudienceShrunk} 가
   * 한다.
   *
   * <p>채널 멤버십 변경 알림은 여기서 미리 내지 않는다 — 누가 빠질지는 맞춘 뒤에야 안다. 미리 내면 실제로 빠진 사람이 없어도 관련된 모든 채널의 모든 멤버가 다시
   * 불러왔다(WP-1186). 맞추기가 사람 행을 바꿨거나 멤버 부서 행이 사라진(부서 삭제 CASCADE) 채널에만 알린다 — 부서 행 수를 여기서 세어 둔다.
   *
   * <p>영향받는 채널 행을 여기서(조직도 변경 전) 잠근다 — 부서 추가처럼 「채널 → 부서(FK)」 순서로 잠그게. 커밋 직전에 처음 잠그면 조직도 변경이 쥔 부서 행
   * 잠금 뒤라 부서 추가와 순서가 엇갈려 교착할 수 있었다. 채널 id 오름차순이다.
   */
  @EventListener
  public void onDepartmentMembersReduced(DepartmentMembersReduced e) {
    List<Long> channelIds = groups.findChannelIdsByGroups(e.groupIds());
    if (channelIds.isEmpty()) {
      return;
    }
    channelIds.forEach(channelRepo::lockState);
    publisher.publishEvent(
        new ChannelDepartmentAudienceShrunk(
            e.tenantId(), e.groupIds(), groups.countGroupsByChannels(e.groupIds())));
  }

  /**
   * 부서로 들어오던 사람이 줄었을 수 있는 채널 — 커밋 직전(같은 트랜잭션, 조직도 변경이 반영된 뒤) 맞춘다. 변경과 맞추기가 함께 커밋되거나 함께 롤백된다. 사람 행이
   * 바뀐 채널에만 roster 이벤트(연동 드라이브 명단 — 동기)와 채널 멤버십 변경 알림(SSE — 맞춘 뒤 명단 + 빠진 사람, 커밋 뒤 전송)을 낸다. SSE 는 이
   * 안에서 발행하면 디스패처에 닿지 않아 디스패처에 바로 넘긴다(WP-1186). 테넌트는 이벤트에 담긴 값으로 세운다.
   */
  @Order(Ordered.HIGHEST_PRECEDENCE)
  @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
  public void onDepartmentAudienceShrunk(ChannelDepartmentAudienceShrunk e) {
    TenantContext.runAs(
        e.tenantId(),
        () -> {
          // 부서를 지웠으면 멤버 부서 행이 CASCADE 로 사라졌다 — 사람 행이 그대로여도 열린 멤버 창의 부서 목록이 다시 받게 알린다.
          Map<Long, Integer> groupsAfter = groups.countGroupsByChannels(e.groupIds());
          for (Map.Entry<Long, Integer> before : e.groupCounts().entrySet()) {
            long channelId = before.getKey();
            Diff diff = sync.reconcile(channelId);
            if (diff.changed()) {
              rosterPublisher.publish(channelId);
            }
            if (diff.changed() || groupsAfter.getOrDefault(channelId, 0) < before.getValue()) {
              changeNotifier.membershipChangedBeforeCommit(channelId, diff.removed());
            }
          }
        });
  }

  /**
   * 채널 보관을 풀었다 — 보관 동안 부서에 들어온 사람은 넣지 않았으므로(읽기 전용) 멤버 부서를 다시 맞춘다. 바뀐 사람이 있으면 알린다. 보관할 때는 할 것이
   * 없다(빼기는 보관돼도 그때그때 한다). 보관 해제와 같은 트랜잭션의 동기 리스너다. 멤버 부서가 없는 채널은 건너뛴다.
   */
  @EventListener
  public void onChannelArchived(ChannelArchivedEvent e) {
    if (!e.archived() && groups.hasGroups(e.channelId())) {
      announce(e.channelId(), null, sync.reconcile(e.channelId()));
    }
  }

  /**
   * DM 에는 부서를 둘 수 없다 — 읽을 수 있는 사람(참여자·시스템 ADMIN)에게는 이유(400), 그 밖의 사람에게는 없는 채널(404, WP-511 존재 은닉).
   */
  private void rejectDm(long callerId, long channelId) {
    if (!perms.canRead(channelId, callerId) && !perms.isSystemAdmin(callerId)) {
      throw new ChannelNotFoundException(channelId);
    }
    throw new IllegalArgumentException("DM 에는 부서를 멤버로 둘 수 없습니다");
  }

  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  /**
   * 조직도 변경 전 영향받는 채널 — 변경 전 동기 리스너가 모아 커밋 직전 맞추기에 넘기는 내부 이벤트.
   *
   * @param tenantId 변경이 일어난 워크스페이스
   * @param groupIds 구성원이 줄어든 부서(상위 부서 포함)
   * @param groupCounts 그 부서를 멤버로 둔 채널 id → 변경 전 그 채널에 걸린 이 부서들의 행 수(채널 id 오름차순)
   */
  public record ChannelDepartmentAudienceShrunk(
      long tenantId, List<Long> groupIds, Map<Long, Integer> groupCounts) {

    /** 영향받는 채널 id. */
    public Collection<Long> channelIds() {
      return groupCounts.keySet();
    }
  }
}
