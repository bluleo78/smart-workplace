package com.workplace.messaging.service;

import com.workplace.messaging.dto.ReactorPage;
import com.workplace.messaging.dto.ReactorResponse;
import com.workplace.messaging.exception.ChannelArchivedException;
import com.workplace.messaging.exception.MessageNotFoundException;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionAddedEvent;
import com.workplace.messaging.outbound.MessagingDomainEvents.ReactionRemovedEvent;
import com.workplace.messaging.repository.ChannelMemberRepository;
import com.workplace.messaging.repository.ChannelRepository;
import com.workplace.messaging.repository.MessageRepository;
import com.workplace.messaging.repository.MessageRepository.Cursor;
import com.workplace.messaging.repository.ReactionRepository;
import com.workplace.messaging.repository.ReactionRepository.ReactorRow;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이모지 리액션 토글. 채널 멤버만, 실제 변경 시에만 AFTER_COMMIT SSE 이벤트 발행. */
@Service
@RequiredArgsConstructor
public class ReactionService {

  private final ReactionRepository reactionRepo;
  private final MessageRepository messageRepo;
  private final ChannelMemberRepository memberRepo;
  private final ChannelRepository channelRepo;
  private final ChannelPermissions perms;
  private final ApplicationEventPublisher publisher;

  /** 리액션 추가(멱등 — 이미 있으면 이벤트 미발행). 이모지 하나가 아니면 400(WP-594). */
  @Transactional
  public void add(long callerId, long messageId, String emoji) {
    long channelId = ensureWritableMessageMember(callerId, messageId);
    // 멤버 검사 뒤에 본다 — 볼 수 없는 메시지에 400 을 먼저 주면 존재가 드러난다(WP-591).
    // 제거(remove)는 검사하지 않는다 — 이 규칙 전에 붙은 글자 리액션도 본인이 뗄 수 있게.
    if (!ReactionEmojis.isSingleEmoji(emoji)) {
      throw new IllegalArgumentException("리액션에는 이모지 하나만 쓸 수 있습니다");
    }
    if (reactionRepo.add(messageId, callerId, emoji))
      publisher.publishEvent(new ReactionAddedEvent(channelId, messageId, emoji, callerId));
  }

  /** 리액션 제거(멱등 — 없으면 이벤트 미발행). */
  @Transactional
  public void remove(long callerId, long messageId, String emoji) {
    long channelId = ensureWritableMessageMember(callerId, messageId);
    if (reactionRepo.remove(messageId, callerId, emoji))
      publisher.publishEvent(new ReactionRemovedEvent(channelId, messageId, emoji, callerId));
  }

  /** 멤버 검증에 더해 보관된 채널이면 막는다 — 보관된 채널은 읽기 전용이라 리액션도 바꿀 수 없다(WP-508). */
  private long ensureWritableMessageMember(long callerId, long messageId) {
    long channelId = ensureMessageMember(callerId, messageId);
    if (channelRepo.isArchived(channelId)) throw new ChannelArchivedException(channelId);
    return channelId;
  }

  /** 메시지의 채널 멤버 여부 검증 후 channelId 반환. 메시지가 없거나 비멤버면 404. */
  private long ensureMessageMember(long callerId, long messageId) {
    long channelId =
        messageRepo
            .findChannelId(messageId)
            .orElseThrow(() -> new MessageNotFoundException(messageId));
    // 비멤버는 없는 메시지와 같은 404 — 403 으로 갈리면 비공개 채널·DM 메시지의 존재가 드러난다(WP-591).
    if (!memberRepo.isMember(channelId, callerId)) throw new MessageNotFoundException(messageId);
    return channelId;
  }

  /** 반응자 목록 limit 상한 — 한 번에 너무 많이 내려주지 않게. */
  private static final int MAX_REACTOR_LIMIT = 50;

  /**
   * 메시지의 이모지별 반응자 페이지. 메시지 목록과 같은 읽기 권한(멤버, 보관된 공개 채널은 누구나 — WP-621). 메시지 목록에는 개수만 싣고, 반응자는 호버·전체
   * 보기 때 이 API 로 필요한 만큼만 받는다(WP-106 지연 로딩).
   */
  @Transactional(readOnly = true)
  public ReactorPage listReactors(
      long callerId, long messageId, String emoji, String cursor, int limit) {
    long channelId =
        messageRepo
            .findChannelId(messageId)
            .orElseThrow(() -> new MessageNotFoundException(messageId));
    if (!perms.canRead(channelId, callerId)) throw new MessageNotFoundException(messageId);
    int size = Math.clamp(limit, 1, MAX_REACTOR_LIMIT);
    List<ReactorRow> rows = reactionRepo.findReactors(messageId, emoji, decodeCursor(cursor), size);
    boolean hasMore = rows.size() > size;
    List<ReactorRow> pageRows = hasMore ? rows.subList(0, size) : rows;
    // 빈 페이지에서 getLast() 가 던지지 않게 hasMore(=다음 페이지 존재, 즉 비어 있지 않음)일 때만 꼬리를 읽는다.
    String next = null;
    if (hasMore) {
      ReactorRow last = pageRows.getLast();
      next = Cursor.encode(new Cursor(last.reactedAt(), last.userId()));
    }
    return new ReactorPage(
        pageRows.stream().map(r -> new ReactorResponse(r.userId(), r.name(), r.kind())).toList(),
        next,
        hasMore);
  }

  /** cursor 문자열 해석. 비었으면 null, 깨졌으면 400(IllegalArgumentException)으로 바꾼다. */
  private static Cursor decodeCursor(String cursor) {
    if (cursor == null || cursor.isBlank()) return null;
    try {
      return Cursor.decode(cursor);
    } catch (RuntimeException e) {
      throw new IllegalArgumentException("잘못된 cursor 입니다");
    }
  }
}
