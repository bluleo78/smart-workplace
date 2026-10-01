package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.USER;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.dto.MentionResponse;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.messaging.dto.LastMessageSummary;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

/**
 * 채널별 마지막 메시지 요약 배치 조회(WP-135 모바일 목록 미리보기). N+1 없이 쿼리 2개 + 멘션 hydrate 1회.
 *
 * <p>기준: 최상위(스레드 답글 제외)·미삭제 메시지 중 id 최대 — 사이드바 미읽음 카운트(unreadCountField)와 같은 집합이라 "배지는 있는데 미리보기는
 * 답글" 같은 불일치가 생기지 않는다. 호출자는 RLS GUC 가 주입된 @Transactional 안에서 호출해야 한다.
 */
@Component
@RequiredArgsConstructor
public class LastMessageLookup {

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;
  private final UserMentionHydrator mentionHydrator;

  /** 채널 id 목록 → (채널 id → 마지막 메시지 요약). 메시지가 없는 채널은 맵에 없다. */
  public Map<Long, LastMessageSummary> findByChannelIds(Collection<Long> channelIds) {
    if (channelIds.isEmpty()) return Map.of();

    // 1) 채널별 마지막 최상위·미삭제 메시지 id.
    List<Long> lastIds =
        dsl.select(DSL.max(MESSAGE.ID))
            .from(MESSAGE)
            .where(MESSAGE.CHANNEL_ID.in(channelIds))
            .and(MESSAGE.DELETED_AT.isNull())
            .and(MESSAGE.PARENT_MESSAGE_ID.isNull())
            .groupBy(MESSAGE.CHANNEL_ID)
            .fetch(0, Long.class);
    if (lastIds.isEmpty()) return Map.of();

    // 2) 본문·작성자·첨부 유무 일괄 조회.
    var hasAttachment =
        DSL.field(
                DSL.exists(
                    DSL.selectOne()
                        .from(MESSAGE_ATTACHMENT)
                        .where(MESSAGE_ATTACHMENT.MESSAGE_ID.eq(MESSAGE.ID))))
            .as("has_attachment");
    var rows =
        dsl.select(
                MESSAGE.ID,
                MESSAGE.CHANNEL_ID,
                MESSAGE.AUTHOR_ID,
                MESSAGE.BODY,
                MESSAGE.MENTIONS,
                MESSAGE.CREATED_AT,
                USER.NAME,
                hasAttachment)
            .from(MESSAGE)
            .leftJoin(USER)
            .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
            .where(MESSAGE.ID.in(lastIds))
            .fetch();

    // 3) 멘션 이름을 한 번에 해석(메시지마다 조회하지 않도록 id 합집합으로 1회).
    Map<Long, List<Long>> mentionsByMessage = new HashMap<>();
    for (var r : rows) mentionsByMessage.put(r.get(MESSAGE.ID), fromJson(r.get(MESSAGE.MENTIONS)));
    Set<Long> allMentionIds =
        mentionsByMessage.values().stream().flatMap(List::stream).collect(Collectors.toSet());
    Map<Long, MentionResponse> mentionById =
        mentionHydrator.asMentionResponses(List.copyOf(allMentionIds)).stream()
            .collect(Collectors.toMap(MentionResponse::id, Function.identity(), (a, b) -> a));

    Map<Long, LastMessageSummary> out = new HashMap<>();
    for (var r : rows) {
      List<MentionResponse> mentions =
          mentionsByMessage.get(r.get(MESSAGE.ID)).stream()
              .map(mentionById::get)
              .filter(java.util.Objects::nonNull)
              .toList();
      Boolean attached = r.get("has_attachment", Boolean.class);
      var created = r.get(MESSAGE.CREATED_AT);
      out.put(
          r.get(MESSAGE.CHANNEL_ID),
          new LastMessageSummary(
              r.get(MESSAGE.ID),
              r.get(MESSAGE.AUTHOR_ID),
              r.get(USER.NAME),
              MessagePushPreview.of(r.get(MESSAGE.BODY), mentions, Boolean.TRUE.equals(attached)),
              created == null ? null : created.toInstant()));
    }
    return out;
  }

  /** mentions JSONB(long[]) → List<Long>. MessageRepository.fromJson 과 같은 이유로 Number 경유 변환. */
  @SneakyThrows
  private List<Long> fromJson(JSONB jsonb) {
    if (jsonb == null) return List.of();
    List<?> raw = objectMapper.readValue(jsonb.data(), List.class);
    return raw.stream().map(n -> ((Number) n).longValue()).toList();
  }
}
