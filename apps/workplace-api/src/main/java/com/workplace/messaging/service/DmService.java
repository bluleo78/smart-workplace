package com.workplace.messaging.service;

import com.workplace.messaging.dto.DmResponse;
import com.workplace.messaging.exception.InvalidDmRequestException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.user.repository.UserRepository;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
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

  /** create 결과 — 신규(201)/기존(200) 구분용. */
  public record DmResult(DmResponse dm, boolean created) {}

  /** 내 DM 목록(최근순). */
  public List<DmResponse> listMyDms(long callerId) {
    return channelRepo.findMyDms(callerId);
  }

  /**
   * caller + targets 멤버셋의 DM 을 찾거나 생성한다. 멤버셋 dedup(정렬 member_key). 1:1 은 타겟 1명 그룹 DM 의 특수
   * 케이스.
   */
  @Transactional
  public DmResult createOrGet(long callerId, List<Long> targetUserIds) {
    if (targetUserIds == null || targetUserIds.isEmpty()) {
      throw new InvalidDmRequestException("대상이 비어 있습니다");
    }
    LinkedHashSet<Long> members = new LinkedHashSet<>();
    members.add(callerId);
    members.addAll(targetUserIds);
    if (members.size() < 2) {
      throw new InvalidDmRequestException("자기 자신과는 DM 할 수 없습니다");
    }
    if (members.size() > MAX_MEMBERS) {
      throw new InvalidDmRequestException("DM 은 본인 포함 최대 " + MAX_MEMBERS + "명입니다");
    }
    for (Long uid : members) {
      if (!userRepo.existsById(uid)) {
        throw new InvalidDmRequestException("존재하지 않는 사용자: " + uid);
      }
    }
    String memberKey =
        members.stream().sorted().map(String::valueOf).collect(Collectors.joining(","));

    // 기존 DM 재사용(idempotent).
    var existing = channelRepo.findDmIdByMemberKey(memberKey);
    if (existing.isPresent()) {
      return new DmResult(channelRepo.findDmDetail(existing.get(), callerId).orElseThrow(), false);
    }
    // 신규 생성 — 동시 생성 레이스는 유니크 인덱스가 차단, catch 후 재조회.
    try {
      long id = channelRepo.insertDm(memberKey, callerId);
      for (Long uid : members) {
        memberRepo.add(id, uid, "MEMBER");
      }
      return new DmResult(channelRepo.findDmDetail(id, callerId).orElseThrow(), true);
    } catch (DuplicateKeyException race) {
      long id = channelRepo.findDmIdByMemberKey(memberKey).orElseThrow();
      return new DmResult(channelRepo.findDmDetail(id, callerId).orElseThrow(), false);
    }
  }
}
