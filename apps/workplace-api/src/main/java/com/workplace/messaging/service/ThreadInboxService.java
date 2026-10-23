package com.workplace.messaging.service;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.MentionParser;
import com.workplace.messaging.dto.MessageResponse;
import com.workplace.messaging.dto.ThreadInboxItem;
import com.workplace.messaging.dto.ThreadInboxPage;
import com.workplace.messaging.repository.ThreadReadStateRepository;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 크로스채널 Threads 인박스 — 1단계 watermark 집계 위에서 읽기 전용 조회. */
@Service
@RequiredArgsConstructor
public class ThreadInboxService {

  private final ThreadReadStateRepository threadReadRepo;
  // 루트 본문의 멘션 토큰 <@id> 를 이름으로 풀 사전 — 일반 메시지 목록(MessageService)과 같은 hydrator 를 쓴다.
  private final UserMentionHydrator mentionHydrator;

  /** 내가 팔로우 + 미읽음 답글이 있는 스레드를 활동순으로. rootMessage 는 카드용 경량 hydrate. */
  @Transactional(readOnly = true)
  public ThreadInboxPage inbox(long callerId, String cursor, int limit) {
    var page = threadReadRepo.inboxPage(callerId, cursor, limit);
    // 본문 멘션 사전 — 페이지 전체의 멘션 id 를 한 번에 조회해(N+1 방지) 루트별로 나눠 싣는다. 비워 두면 본문에는 <@id> 토큰이 남는데
    // 이름을 풀 수단이 없어 소비자(외부 MCP 홈 개요 등)에서 "알 수 없는 사용자"로 보인다.
    Map<Long, MentionResponse> mentionsById =
        mentionHydrator
            .asMentionResponses(
                List.copyOf(
                    page.rows().stream()
                        .flatMap(row -> MentionParser.parse(row.body()).stream())
                        .collect(Collectors.toCollection(LinkedHashSet::new))))
            .stream()
            .collect(Collectors.toMap(MentionResponse::id, Function.identity(), (a, b) -> a));
    List<ThreadInboxItem> items =
        page.rows().stream()
            .map(
                row -> {
                  // 카드용 루트 메시지: reactions/attachments 빈, replyCount 0(카드 불필요), mentions 는 본문 토큰
                  // 해석용으로만 채움,
                  // unreadReplyCount/followed 는 집계값으로 채움.
                  MessageResponse root =
                      new MessageResponse(
                          row.rootId(),
                          row.channelId(),
                          row.authorId(),
                          row.authorName(),
                          row.authorKind(),
                          row.body(),
                          MentionParser.parse(row.body()).stream()
                              .map(mentionsById::get)
                              .filter(java.util.Objects::nonNull)
                              .toList(), // mentions — 본문 <@id> 해석용
                          null, // parentMessageId — 루트라 없음
                          0, // replyCount — 카드 불필요
                          List.of(), // reactions — 카드 불필요
                          List.of(), // attachments — 카드 불필요
                          List.of(), // driveLinks — 카드 불필요
                          row.createdAt(),
                          null, // editedAt
                          false, // deleted
                          row.unreadReplyCount(),
                          true, // followed — 인박스에 떴다는 건 팔로우 중
                          null, // proposal — 카드 불필요(인박스 카드)
                          List.of()); // linkPreviews — 카드 불필요
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
