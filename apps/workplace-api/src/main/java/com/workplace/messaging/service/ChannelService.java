package com.workplace.messaging.service;

import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.util.UnicodeNames;
import com.workplace.messaging.dto.ChannelResponse;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.ChannelForbiddenException;
import com.workplace.messaging.exception.ChannelNameDuplicatedException;
import com.workplace.messaging.exception.ChannelNotFoundException;
import com.workplace.messaging.outbound.ChannelChangeNotifier;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelArchivedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelDeletingEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ChannelRenamedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import java.time.Instant;
import java.util.List;
import java.util.Set;
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
  private final ChannelChangeNotifier changeNotifier;
  private final LastMessageLookup lastMessageLookup;
  private final ChannelRosterPublisher rosterPublisher;

  /**
   * 사이드바 — caller 가 멤버이고 아카이브되지 않은 채널만. 모바일 목록 미리보기용 lastMessage 를 배치로 채운다(WP-135). RLS GUC 주입
   * 위해 @Transactional 필요(없으면 빈 결과).
   */
  @Transactional(readOnly = true)
  public List<ChannelResponse> list(long callerId) {
    List<ChannelResponse> channels = channelRepo.findMyChannels(callerId);
    var last =
        lastMessageLookup.findByChannelIds(channels.stream().map(ChannelResponse::id).toList());
    return channels.stream().map(c -> c.withLastMessage(last.get(c.id()))).toList();
  }

  /** 탐색 — 공개·비아카이브 채널 검색(q ILIKE). RLS GUC 주입 위해 @Transactional 필요(없으면 빈 결과). */
  @Transactional(readOnly = true)
  public List<ChannelResponse> discover(long callerId, String q) {
    return channelRepo.searchDiscoverable(callerId, q);
  }

  /**
   * 채널 생성 — 생성자를 OWNER 로 add. visibility null → PUBLIC. 이름은 만드는 사람이 볼 수 있는 활성 채널(공개 + 내가 멤버인 비공개)과
   * 겹칠 수 없다(#688 의 "컨테이너류 이름은 식별자" 정책을 WP-590 에서 볼 수 있는 범위로 좁힘 — 볼 수 없는 비공개 채널 존재를 숨기려고).
   */
  @Transactional
  public ChannelResponse create(long callerId, String rawName, String visibility) {
    String name = normalizeName(rawName);
    if (channelRepo.existsVisibleChannelName(name, callerId, null)) {
      throw new ChannelNameDuplicatedException(name);
    }
    String vis = normalizeVisibility(visibility);
    long channelId = channelRepo.insert(name, vis, callerId);
    memberRepo.add(channelId, callerId, "OWNER");
    ChannelResponse created =
        channelRepo
            .findDetail(channelId, callerId)
            .orElseThrow(() -> new ChannelNotFoundException(channelId));
    changeNotifier.channelChanged(
        ResourceChangedEvent.OP_CREATED, channelId, "PUBLIC".equals(vis), callerId, Set.of());
    return created;
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
      // 비공개 채널 비멤버에겐 존재를 숨긴다(WP-511). 이미 멤버면 403.
      if (!ch.member()) throw new ChannelNotFoundException(channelId);
      throw new ChannelForbiddenException(channelId, callerId, "join-private");
    }
    // 보관된 채널은 읽기 전용 — 새로 참여할 수 없다(WP-508).
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
    memberRepo.add(channelId, callerId, "MEMBER");
    // 참여도 멤버 변경 — roster 이벤트로 연동 드라이브 공간에 곧바로 반영한다(WP-531).
    rosterPublisher.publish(channelId);
    changeNotifier.membershipChanged(channelId, callerId, Set.of());
  }

  /** 이름 변경 — OWNER/ADMIN 또는 시스템 ADMIN. 바꾸는 사람이 볼 수 있는 활성 채널 이름과는 겹칠 수 없다(#688·WP-590). */
  @Transactional
  public ChannelResponse rename(long callerId, long channelId, String rawName) {
    String name = normalizeName(rawName);
    ensureExists(channelId);
    perms.requireManage(channelId, callerId, "rename");
    // 보관된 채널은 읽기 전용 — 이름을 바꾸려면 먼저 보관을 해제한다(WP-508).
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
    if (channelRepo.existsVisibleChannelName(name, callerId, channelId)) {
      throw new ChannelNameDuplicatedException(name);
    }
    channelRepo.rename(channelId, name);
    // 연동 드라이브 공간 이름도 따라 바꾼다(WP-532) — 공간이 없으면 drive 쪽에서 no-op.
    publisher.publishEvent(new ChannelRenamedEvent(channelId, name, Instant.now()));
    ChannelResponse renamed =
        channelRepo
            .findDetail(channelId, callerId)
            .orElseThrow(() -> new ChannelNotFoundException(channelId));
    changeNotifier.channelChanged(
        ResourceChangedEvent.OP_UPDATED,
        channelId,
        "PUBLIC".equals(renamed.visibility()),
        callerId,
        Set.of());
    return renamed;
  }

  /** 아카이브 — OWNER 또는 시스템 ADMIN. */
  @Transactional
  public void archive(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireOwner(channelId, callerId, "archive");
    channelRepo.setArchived(channelId, true);
    publisher.publishEvent(new ChannelArchivedEvent(channelId, true, Instant.now()));
    notifyChannelUpdated(channelId, callerId);
  }

  /** 아카이브 해제 — OWNER 또는 시스템 ADMIN. */
  @Transactional
  public void unarchive(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireOwner(channelId, callerId, "unarchive");
    channelRepo.setArchived(channelId, false);
    publisher.publishEvent(new ChannelArchivedEvent(channelId, false, Instant.now()));
    notifyChannelUpdated(channelId, callerId);
  }

  /** 하드 삭제 — 시스템 ADMIN 만. */
  @Transactional
  public void hardDelete(long callerId, long channelId) {
    ensureExists(channelId);
    perms.requireSystemAdmin(callerId, "delete-channel");
    // cascade 로 멤버가 사라지므로 삭제 전 명단을 확보해 추가 수신자로 넘긴다.
    List<Long> before = memberRepo.findMemberIds(channelId);
    boolean isPublic = isPublicChannel(channelId, callerId);
    // 연동 드라이브 공간도 함께 영구 삭제(WP-525) — 채널 행을 지우면 연결이 끊겨 공간을 못 찾으므로 먼저 알린다.
    publisher.publishEvent(new ChannelDeletingEvent(channelId, callerId, Instant.now()));
    channelRepo.hardDelete(channelId);
    changeNotifier.channelChanged(
        ResourceChangedEvent.OP_DELETED, channelId, isPublic, callerId, before);
  }

  /** 채널 자체 변경(updated) 발행 — 공개 여부는 현재 상세 조회로 판단한다. */
  private void notifyChannelUpdated(long channelId, long callerId) {
    changeNotifier.channelChanged(
        ResourceChangedEvent.OP_UPDATED,
        channelId,
        isPublicChannel(channelId, callerId),
        callerId,
        Set.of());
  }

  private boolean isPublicChannel(long channelId, long callerId) {
    return channelRepo
        .findDetail(channelId, callerId)
        .map(c -> "PUBLIC".equals(c.visibility()))
        .orElse(false);
  }

  private void ensureExists(long channelId) {
    if (!channelRepo.exists(channelId)) throw new ChannelNotFoundException(channelId);
  }

  /**
   * 채널 이름을 앞뒤 공백을 다듬고 NFC 로 맞춘다(WP-592) — 공백만 다른 이름이 중복 검사를 지나 사이드바·탐색에 같은 이름으로 여러 번 보이지 않게. 웹은 이미
   * 다듬어 보내지만 API 를 직접 부르는 AI 도구(MCP create_channel 등)는 그대로 보낸다.
   */
  private static String normalizeName(String raw) {
    String name = raw == null ? "" : UnicodeNames.toNfc(raw.strip());
    if (name.isEmpty()) throw new IllegalArgumentException("채널 이름을 입력해 주세요");
    return name;
  }

  private String normalizeVisibility(String visibility) {
    if (visibility == null || visibility.isBlank()) return "PUBLIC";
    String v = visibility.trim().toUpperCase();
    if (!v.equals("PUBLIC") && !v.equals("PRIVATE")) {
      throw new IllegalArgumentException("올바르지 않은 채널 공개 범위입니다 (visibility: " + visibility + ")");
    }
    return v;
  }
}
