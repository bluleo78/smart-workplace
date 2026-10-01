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
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

/**
 * 채널별 마지막 메시지 요약 배치 조회(WP-135 모바일 목록 미리보기). N+1 없이 쿼리 1개 + 멘션 hydrate.
 *
 * <p>기준: 최상위(스레드 답글 제외)·미삭제 메시지 중 최신(created_at, id 내림차순 — 타임라인 순서) — 사이드바 미읽음
 * 카운트(unreadCountField)와 같은 집합이라 "배지는 있는데 미리보기는 답글" 같은 불일치가 생기지 않는다. 채널별 LATERAL + LIMIT 1 로
 * idx_message_channel_created 를 타므로 조회 비용이 메시지 이력이 아니라 채널 수에 비례한다(기존 max(id) GROUP BY 는 소속 채널의 전
 * 메시지를 스캔했다). 호출자는 RLS GUC 가 주입된 @Transactional 안에서 호출해야 한다.
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

    // 1) 채널별 마지막 최상위·미삭제 메시지를 LATERAL + LIMIT 1 로 한 번에 읽는다 — 채널마다
    //    인덱스(channel_id, created_at DESC, id DESC)로 1행만 읽으므로 비용이 대화 이력이 아니라 채널 수에 비례한다.
    //    본문·멘션·첨부 유무까지 같은 문장에서 가져오고 작성자 이름만 바깥 LEFT JOIN 으로 붙인다.
    var ch = DSL.unnest(channelIds.toArray(Long[]::new)).as("c", "id");
    Field<Long> chId = ch.field("id", Long.class);
    var hasAttachment =
        DSL.field(
                DSL.exists(
                    DSL.selectOne()
                        .from(MESSAGE_ATTACHMENT)
                        .where(MESSAGE_ATTACHMENT.MESSAGE_ID.eq(MESSAGE.ID))))
            .as("has_attachment");
    var last =
        DSL.lateral(
                DSL.select(
                        MESSAGE.ID,
                        MESSAGE.CHANNEL_ID,
                        MESSAGE.AUTHOR_ID,
                        MESSAGE.BODY,
                        MESSAGE.MENTIONS,
                        MESSAGE.CREATED_AT,
                        hasAttachment)
                    .from(MESSAGE)
                    .where(MESSAGE.CHANNEL_ID.eq(chId))
                    .and(MESSAGE.DELETED_AT.isNull())
                    .and(MESSAGE.PARENT_MESSAGE_ID.isNull())
                    .orderBy(MESSAGE.CREATED_AT.desc(), MESSAGE.ID.desc())
                    .limit(1))
            .as("m");
    var rows =
        dsl.select(
                last.field(MESSAGE.ID),
                last.field(MESSAGE.CHANNEL_ID),
                last.field(MESSAGE.AUTHOR_ID),
                last.field(MESSAGE.BODY),
                last.field(MESSAGE.MENTIONS),
                last.field(MESSAGE.CREATED_AT),
                USER.NAME,
                last.field("has_attachment", Boolean.class))
            .from(ch)
            .crossJoin(last)
            .leftJoin(USER)
            .on(USER.ID.eq(last.field(MESSAGE.AUTHOR_ID)))
            .fetch();
    if (rows.isEmpty()) return Map.of();

    // 2) 멘션 이름을 한 번에 해석(메시지마다 조회하지 않도록 id 합집합으로 1회).
    Map<Long, List<Long>> mentionsByMessage = new HashMap<>();
    for (var r : rows)
      mentionsByMessage.put(
          r.get(last.field(MESSAGE.ID)), fromJson(r.get(last.field(MESSAGE.MENTIONS))));
    Set<Long> allMentionIds =
        mentionsByMessage.values().stream().flatMap(List::stream).collect(Collectors.toSet());
    // 멘션이 하나도 없으면 hydrate 쿼리를 건너뛴다.
    Map<Long, MentionResponse> mentionById =
        allMentionIds.isEmpty()
            ? Map.of()
            : mentionHydrator.asMentionResponses(List.copyOf(allMentionIds)).stream()
                .collect(Collectors.toMap(MentionResponse::id, Function.identity(), (a, b) -> a));

    Map<Long, LastMessageSummary> out = new HashMap<>();
    for (var r : rows) {
      List<MentionResponse> mentions =
          mentionsByMessage.get(r.get(last.field(MESSAGE.ID))).stream()
              .map(mentionById::get)
              .filter(Objects::nonNull)
              .toList();
      Boolean attached = r.get(last.field("has_attachment", Boolean.class));
      var created = r.get(last.field(MESSAGE.CREATED_AT));
      out.put(
          r.get(last.field(MESSAGE.CHANNEL_ID)),
          new LastMessageSummary(
              r.get(last.field(MESSAGE.ID)),
              r.get(last.field(MESSAGE.AUTHOR_ID)),
              r.get(USER.NAME),
              MessagePushPreview.of(
                  r.get(last.field(MESSAGE.BODY)), mentions, Boolean.TRUE.equals(attached)),
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
