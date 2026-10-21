package com.workplace.messaging.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.exception.InactiveMemberException;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.messaging.outbound.ChannelChangeNotifier;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.repository.UserRepository;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** DM(다이렉트 메시지) — find-or-create(멤버셋 dedup) + 내 DM 목록. */
@Service
@RequiredArgsConstructor
public class DmService {

  private static final int MAX_MEMBERS = 8; // 본인 포함

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final UserRepository userRepo;
  private final MembershipRepository membershipRepo;
  private final ChannelChangeNotifier changeNotifier;
  private final LastMessageLookup lastMessageLookup;

  /** create 결과 — 신규(201)/기존(200) 구분용. */
  public record DmResult(DmResponse dm, boolean created) {}

  /** 내 DM 목록(최근순) + 모바일 목록 미리보기용 lastMessage(WP-135). RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public List<DmResponse> listMyDms(long callerId) {
    List<DmResponse> dms = channelRepo.findMyDms(callerId);
    var last = lastMessageLookup.findByChannelIds(dms.stream().map(DmResponse::id).toList());
    return dms.stream().map(d -> d.withLastMessage(last.get(d.id()))).toList();
  }

  /** caller + targets 멤버셋의 DM 을 찾거나 생성한다. 멤버셋 dedup(정렬 member_key). 1:1 은 타겟 1명 그룹 DM 의 특수 케이스. */
  @Transactional
  public DmResult createOrGet(long callerId, List<Long> targetUserIds) {
    if (targetUserIds == null || targetUserIds.isEmpty()) {
      throw new InvalidDmRequestException("대상이 비어 있습니다");
    }
    LinkedHashSet<Long> members = new LinkedHashSet<>();
    members.add(callerId);
    members.addAll(targetUserIds);
    // self-DM(본인만, size==1) 허용 — 개인 메모 공간. 빈 멤버셋만 방어(상단 targetUserIds 검사로 사실상 불가).
    if (members.isEmpty()) {
      throw new InvalidDmRequestException("대상이 비어 있습니다");
    }
    if (members.size() > MAX_MEMBERS) {
      throw new InvalidDmRequestException("DM 은 본인 포함 최대 " + MAX_MEMBERS + "명입니다");
    }
    // DM 참여자 유효성 검사 — 존재 여부 + 현재 테넌트 멤버십(테넌트 경계를 넘는 DM 생성 차단, 설계 §4).
    Long tenantId = TenantContext.get();
    for (Long uid : members) {
      var user =
          userRepo
              .findById(uid)
              .orElseThrow(() -> new InvalidDmRequestException("존재하지 않는 사용자가 포함되어 있습니다"));
      var status =
          tenantId == null
              ? java.util.Optional.<String>empty()
              : membershipRepo.findStatus(uid, tenantId);
      if (status.isEmpty()) {
        // 토스트로 보이는 문구라 사용자 id 는 싣지 않는다(WP-510).
        throw new InvalidDmRequestException("현재 워크스페이스의 멤버가 아닌 사용자가 포함되어 있습니다");
      }
      // WP-723: 멤버지만 정지(또는 전역 비활성)된 사람은 「멤버가 아닌 사용자」가 아니라 실제 이유로 거절한다.
      if (!WorkspaceActive.of(user.isActive(), status.get())) {
        throw new InactiveMemberException("비활성화된 구성원과는 대화를 시작할 수 없습니다");
      }
    }
    String memberKey =
        members.stream().sorted().map(String::valueOf).collect(Collectors.joining(","));

    // 기존 DM 재사용(idempotent).
    var existing = channelRepo.findDmIdByMemberKey(memberKey);
    if (existing.isPresent()) {
      return new DmResult(rejoinIfLeft(existing.get(), callerId), false);
    }
    // 신규 생성 — ON CONFLICT DO NOTHING 으로 동시 생성 레이스를 트랜잭션 abort 없이 처리.
    var inserted = channelRepo.insertDmIfAbsent(memberKey, callerId);
    if (inserted.isPresent()) {
      long id = inserted.get();
      for (Long uid : members) {
        memberRepo.add(id, uid, "MEMBER");
      }
      // 신규 생성일 때만 발행 — 기존 DM 재사용은 목록 변화가 없다.
      changeNotifier.dmCreated(id, callerId);
      return new DmResult(channelRepo.findDmDetail(id, callerId).orElseThrow(), true);
    }
    // 레이스 패자: 동시 트랜잭션이 먼저 생성 → 기존 DM 재사용.
    long existingId = channelRepo.findDmIdByMemberKey(memberKey).orElseThrow();
    return new DmResult(rejoinIfLeft(existingId, callerId), false);
  }

  /**
   * 기존 DM 의 상세를 돌려준다. 호출자가 그 DM 을 나갔으면(member_key 에는 남아 있음) 다시 참여시킨다(WP-507).
   *
   * <p>나가도 member_key 는 그대로라 같은 구성으로 다시 열면 이 DM 이 찾아진다. 호출자는 원래 참여자이므로 다시 넣어도 새 사람에게 이력이 노출되지 않는다.
   * 다시 넣지 않으면 상세 조회가 비어 500 이 나고 그 상대와 영영 DM 을 할 수 없다.
   */
  private DmResponse rejoinIfLeft(long dmId, long callerId) {
    if (!memberRepo.isMember(dmId, callerId)) {
      memberRepo.add(dmId, callerId, "MEMBER");
      // 호출자의 DM 목록에 다시 나타나도록 생성과 같은 이벤트를 발행한다.
      changeNotifier.dmCreated(dmId, callerId);
    }
    return channelRepo.findDmDetail(dmId, callerId).orElseThrow();
  }
}
