package com.workplace.messaging.service;

import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.ThreadInboxItem;
import com.workplace.messaging.dto.ThreadInboxPage;
import com.workplace.messaging.repository.ThreadReadStateRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 크로스채널 Threads 인박스 — 1단계 watermark 집계 위에서 읽기 전용 조회. */
@Service
@RequiredArgsConstructor
public class ThreadInboxService {

  private final ThreadReadStateRepository threadReadRepo;

  /** 내가 팔로우 + 미읽음 답글이 있는 스레드를 활동순으로. rootMessage 는 카드용 경량 hydrate. */
  @Transactional(readOnly = true)
  public ThreadInboxPage inbox(long callerId, String cursor, int limit) {
    var page = threadReadRepo.inboxPage(callerId, cursor, limit);
    List<ThreadInboxItem> items =
        page.rows().stream()
            .map(
                row -> {
                  // 카드용 루트 메시지: mentions/reactions/attachments 빈, replyCount 0(카드 불필요),
                  // unreadReplyCount/followed 는 집계값으로 채움.
                  MessageResponse root =
                      new MessageResponse(
                          row.rootId(),
                          row.channelId(),
                          row.authorId(),
                          row.authorName(),
                          row.authorKind(),
                          row.body(),
                          List.of(), // mentions — 카드 불필요
                          null, // parentMessageId — 루트라 없음
                          0, // replyCount — 카드 불필요
                          List.of(), // reactions — 카드 불필요
                          List.of(), // attachments — 카드 불필요
                          List.of(), // driveLinks — 카드 불필요
                          row.createdAt(),
                          null, // editedAt
                          false, // deleted
                          row.unreadReplyCount(),
                          true); // followed — 인박스에 떴다는 건 팔로우 중
                  return new ThreadInboxItem(root, row.channelName(), row.lastReplyAt());
                })
            .toList();
    return new ThreadInboxPage(items, page.nextCursor(), page.hasMore());
  }

  /** 미읽음 스레드 개수(뱃지). */
  @Transactional(readOnly = true)
  public long unreadThreadCount(long callerId) {
    return threadReadRepo.inboxUnreadThreadCount(callerId);
  }
}
