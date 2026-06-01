package com.workplace.messaging.service;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 목록/생성/참여. Phase 1 은 공개 채널만. */
@Service
@RequiredArgsConstructor
public class ChannelService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;

  /** caller 가 멤버 여부 플래그가 채워진 전체 공개 채널 목록. */
  public List<ChannelResponse> list(long callerId) {
    return channelRepo.findAllWithMembership(callerId);
  }

  /** 공개 채널 생성 + 생성자를 첫 멤버로 add. */
  @Transactional
  public ChannelResponse create(long callerId, String name) {
    long channelId = channelRepo.insertPublic(name, callerId);
    memberRepo.join(channelId, callerId);
    return channelRepo
        .findOne(channelId, callerId)
        .orElseThrow(() -> new ChannelNotFoundException(channelId));
  }

  /** 공개 채널 참여 (idempotent). */
  @Transactional
  public void join(long callerId, long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
    memberRepo.join(channelId, callerId);
  }
}
