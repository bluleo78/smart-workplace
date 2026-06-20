package com.workplace.messaging.service;

import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelArchivedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 채널 목록/탐색/생성/상세/관리(이름변경·아카이브·삭제). */
@Service
@RequiredArgsConstructor
public class ChannelService {

  private final ChannelRepository channelRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelPermissions perms;
  private final ApplicationEventPublisher publisher;

  /** 사이드바 — caller 가 멤버이고 아카이브되지 않은 채널만. RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public List<ChannelResponse> list(long callerId) {
    return channelRepo.findMyChannels(callerId);
  }

  /** 탐색 — 공개·비아카이브 채널 검색(q ILIKE). RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public List<ChannelResponse> discover(long callerId, String q) {
    return channelRepo.searchDiscoverable(callerId, q);
  }

  /** 채널 생성 — 생성자를 OWNER 로 add. visibility null → PUBLIC. */
  @Transactional
  public ChannelResponse create(long callerId, String name, String visibility) {
    String vis = normalizeVisibility(visibility);
    long channelId = channelRepo.insert(name, vis, callerId);
    memberRepo.add(channelId, callerId, "OWNER");
    return channelRepo
        .findDetail(channelId, callerId)
        .orElseThrow(() -> new ChannelNotFoundException(channelId));
  }

  /** 상세 — 공개 채널은 누구나, 비공개는 멤버만(비멤버 404 은닉). RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public ChannelResponse getDetail(long callerId, long channelId) {
    ChannelResponse ch =
        channelRepo
            .findDetail(channelId, callerId)
            .orElseThrow(() -> new ChannelNotFoundException(channelId));
    if (!"PUBLIC".equals(ch.visibility()) && !ch.member()) {
      throw new ChannelNotFoundException(channelId); // 비공개 존재 은닉
    }
    return ch;
  }

  /** 공개 채널 참여 — 비공개면 403. idempotent. */
  @Transactional
  public void join(long callerId, long channelId) {
    ChannelResponse ch =
        channelRepo
            .findDetail(channelId, callerId)
            .orElseThrow(() -> new ChannelNotFoundException(channelId));
    if (!"PUBLIC".equals(ch.visibility())) {
      throw new ChannelForbiddenException(channelId, callerId, "join-private");
    }
    memberRepo.add(channelId, callerId, "MEMBER");
  }

  /** 이름 변경 — OWNER/ADMIN 또는 시스템 ADMIN. */
  @Transactional
  public ChannelResponse rename(long callerId, long channelId, String name) {
    ensureExists(channelId);
    perms.requireManage(channelId, callerId, "rename");
    channelRepo.rename(channelId, name);
    return channelRepo
        .findDetail(channelId, callerId)
        .orElseThrow(() -> new ChannelNotFoundException(channelId));
  }

  /** 아카이브 — OWNER 또는 시스템 ADMIN. */
  @Transactional
  public void archive(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireOwner(channelId, callerId, "archive");
    channelRepo.setArchived(channelId, true);
    publisher.publishEvent(new ChannelArchivedEvent(channelId, true, Instant.now()));
  }

  /** 아카이브 해제 — OWNER 또는 시스템 ADMIN. */
  @Transactional
  public void unarchive(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireOwner(channelId, callerId, "unarchive");
    channelRepo.setArchived(channelId, false);
    publisher.publishEvent(new ChannelArchivedEvent(channelId, false, Instant.now()));
  }

  /** 하드 삭제 — 시스템 ADMIN 만. */
  @Transactional
  public void hardDelete(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireSystemAdmin(callerId, "delete-channel");
    channelRepo.hardDelete(channelId);
  }

  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  private String normalizeVisibility(String visibility) {
    if (visibility == null || visibility.isBlank()) return "PUBLIC";
    String v = visibility.trim().toUpperCase();
    if (!v.equals("PUBLIC") && !v.equals("PRIVATE")) {
      throw new IllegalArgumentException("invalid visibility: " + visibility);
    }
    return v;
  }
}
