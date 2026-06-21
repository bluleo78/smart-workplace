package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.dto.MentionResponse;
import com.workplace.messaging.dto.MessagePage;
import com.workplace.messaging.dto.MessageResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.SneakyThrows;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.SelectConditionStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * message 리포지토리. cursor = base64(epochSecond|nano|id) DESC. soft-deleted 메시지는 body 를 "(삭제됨)" 으로
 * 마스킹해 응답에 포함 (UI 순서 보존). mentions 는 user.id 의 long[] 형태로 JSONB 저장하고, 조회 시 MentionResolver 로
 * hydrate.
 */
@Repository
@RequiredArgsConstructor
public class MessageRepository {

  private static final String DELETED_BODY = "(삭제됨)";
  private static final int MAX_LIMIT = 100;

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /** 메시지 작성 후 ID 반환. mentions 는 user.id 의 long[] 형태로 저장. parentMessageId 있으면 스레드 답글. */
  public long insert(
      long channelId, long authorId, String body, List<Long> mentionUserIds, Long parentMessageId) {
    return dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, authorId)
        .set(MESSAGE.BODY, body)
        .set(MESSAGE.MENTIONS, JSONB.valueOf(toJson(mentionUserIds)))
        .set(MESSAGE.PARENT_MESSAGE_ID, parentMessageId)
        .returning(MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** 메시지 body·mentions·edited_at 수정. */
  public void update(long id, String body, java.util.List<Long> mentionUserIds) {
    dsl.update(MESSAGE)
        .set(MESSAGE.BODY, body)
        .set(MESSAGE.MENTIONS, JSONB.valueOf(toJson(mentionUserIds)))
        .set(MESSAGE.EDITED_AT, java.time.OffsetDateTime.now())
        .where(MESSAGE.ID.eq(id))
        .execute();
  }

  /** soft-delete: deleted_at 설정. */
  public void softDelete(long id) {
    dsl.update(MESSAGE)
        .set(MESSAGE.DELETED_AT, java.time.OffsetDateTime.now())
        .where(MESSAGE.ID.eq(id))
        .execute();
  }

  /** 메시지 작성자 id 조회. 미존재 시 Optional.empty(). */
  public Optional<Long> findAuthorId(long id) {
    return dsl.select(MESSAGE.AUTHOR_ID)
        .from(MESSAGE)
        .where(MESSAGE.ID.eq(id))
        .fetchOptional(MESSAGE.AUTHOR_ID);
  }

  /** 메시지 채널 id 조회. 미존재 시 Optional.empty(). */
  public Optional<Long> findChannelId(long id) {
    return dsl.select(MESSAGE.CHANNEL_ID)
        .from(MESSAGE)
        .where(MESSAGE.ID.eq(id))
        .fetchOptional(MESSAGE.CHANNEL_ID);
  }

  /** 메시지가 해당 채널 소속인지. 다운로드 시 메시지-채널 정합성 검증용. */
  public boolean belongsToChannel(long messageId, long channelId) {
    return dsl.fetchExists(
        dsl.selectFrom(MESSAGE)
            .where(MESSAGE.ID.eq(messageId))
            .and(MESSAGE.CHANNEL_ID.eq(channelId)));
  }

  /** 메시지의 channel_id + parent_message_id + author_id 조회(스레드 부모 검증·팔로우용). 미존재 시 empty. */
  public Optional<MessageRef> findRef(long id) {
    return dsl.select(MESSAGE.CHANNEL_ID, MESSAGE.PARENT_MESSAGE_ID, MESSAGE.AUTHOR_ID)
        .from(MESSAGE)
        .where(MESSAGE.ID.eq(id))
        .fetchOptional(
            r ->
                new MessageRef(
                    r.get(MESSAGE.CHANNEL_ID),
                    r.get(MESSAGE.PARENT_MESSAGE_ID),
                    r.get(MESSAGE.AUTHOR_ID)));
  }

  /** 부모 검증/팔로우용 경량 메시지 참조. parentMessageId == null 이면 최상위 메시지. */
  public record MessageRef(long channelId, Long parentMessageId, long authorId) {}

  /** 스레드의 최신 답글 id(없으면 0). 패널 열기 시 watermark 설정용. */
  public long maxReplyId(long rootId) {
    Long v =
        dsl.select(DSL.max(MESSAGE.ID))
            .from(MESSAGE)
            .where(MESSAGE.PARENT_MESSAGE_ID.eq(rootId).and(MESSAGE.DELETED_AT.isNull()))
            .fetchOne(0, Long.class);
    return v == null ? 0L : v;
  }

  /** 이 메시지에 달린 답글 수 상관 서브쿼리(삭제 포함 — 패널 표시와 일치). */
  private static Field<Integer> replyCountField() {
    com.workplace.jooq.tables.Message child = MESSAGE.as("child");
    return DSL.selectCount()
        .from(child)
        .where(child.PARENT_MESSAGE_ID.eq(MESSAGE.ID))
        .asField("reply_count");
  }

  /** id 로 단건 조회. soft-deleted 도 body 마스킹해 반환. */
  public Optional<MessageResponse> findById(long id, MentionResolver resolver) {
    return dsl.select(
            MESSAGE.ID,
            MESSAGE.CHANNEL_ID,
            MESSAGE.AUTHOR_ID,
            USER.NAME,
            USER.KIND,
            MESSAGE.BODY,
            MESSAGE.MENTIONS,
            MESSAGE.CREATED_AT,
            MESSAGE.EDITED_AT,
            MESSAGE.DELETED_AT,
            MESSAGE.PARENT_MESSAGE_ID,
            replyCountField())
        .from(MESSAGE)
        .join(USER)
        .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
        .where(MESSAGE.ID.eq(id))
        .fetchOptional(r -> toResponse(r, resolver));
  }

  /**
   * Cursor 페이징. nextCursor 는 base64(epochSecond|nano|id). DESC 정렬. parent IS NULL 인 최상위 메시지만 반환.
   */
  public MessagePage findPage(long channelId, String cursor, int limit, MentionResolver resolver) {
    int safeLimit = Math.min(limit, MAX_LIMIT);
    SelectConditionStep<?> query =
        dsl.select(
                MESSAGE.ID,
                MESSAGE.CHANNEL_ID,
                MESSAGE.AUTHOR_ID,
                USER.NAME,
                USER.KIND,
                MESSAGE.BODY,
                MESSAGE.MENTIONS,
                MESSAGE.CREATED_AT,
                MESSAGE.EDITED_AT,
                MESSAGE.DELETED_AT,
                MESSAGE.PARENT_MESSAGE_ID,
                replyCountField())
            .from(MESSAGE)
            .join(USER)
            .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
            .where(MESSAGE.CHANNEL_ID.eq(channelId).and(MESSAGE.PARENT_MESSAGE_ID.isNull()));

    if (cursor != null && !cursor.isEmpty()) {
      Cursor c = Cursor.decode(cursor);
      OffsetDateTime cursorTs = OffsetDateTime.ofInstant(c.createdAt(), ZoneOffset.UTC);
      query =
          query.and(
              MESSAGE
                  .CREATED_AT
                  .lessThan(cursorTs)
                  .or(MESSAGE.CREATED_AT.eq(cursorTs).and(MESSAGE.ID.lessThan(c.id()))));
    }

    List<MessageResponse> items =
        query
            .orderBy(MESSAGE.CREATED_AT.desc(), MESSAGE.ID.desc())
            .limit(safeLimit + 1)
            .fetch(r -> toResponse(r, resolver));

    boolean hasMore = items.size() > safeLimit;
    if (hasMore) items = items.subList(0, safeLimit);
    String nextCursor = null;
    if (hasMore && !items.isEmpty()) {
      MessageResponse last = items.get(items.size() - 1);
      nextCursor = Cursor.encode(new Cursor(last.createdAt(), last.id()));
    }
    return new MessagePage(items, nextCursor, hasMore);
  }

  /** 특정 부모 메시지의 답글 페이지. 오래된→최신(ASC) keyset. soft-deleted 답글도 마스킹해 포함. */
  public MessagePage findThreadPage(
      long parentMessageId, String cursor, int limit, MentionResolver resolver) {
    int safeLimit = Math.min(limit, MAX_LIMIT);
    SelectConditionStep<?> query =
        dsl.select(
                MESSAGE.ID,
                MESSAGE.CHANNEL_ID,
                MESSAGE.AUTHOR_ID,
                USER.NAME,
                USER.KIND,
                MESSAGE.BODY,
                MESSAGE.MENTIONS,
                MESSAGE.CREATED_AT,
                MESSAGE.EDITED_AT,
                MESSAGE.DELETED_AT,
                MESSAGE.PARENT_MESSAGE_ID,
                replyCountField())
            .from(MESSAGE)
            .join(USER)
            .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
            .where(MESSAGE.PARENT_MESSAGE_ID.eq(parentMessageId));

    if (cursor != null && !cursor.isEmpty()) {
      Cursor c = Cursor.decode(cursor);
      OffsetDateTime cursorTs = OffsetDateTime.ofInstant(c.createdAt(), ZoneOffset.UTC);
      query =
          query.and(
              MESSAGE
                  .CREATED_AT
                  .greaterThan(cursorTs)
                  .or(MESSAGE.CREATED_AT.eq(cursorTs).and(MESSAGE.ID.greaterThan(c.id()))));
    }

    List<MessageResponse> items =
        query
            .orderBy(MESSAGE.CREATED_AT.asc(), MESSAGE.ID.asc())
            .limit(safeLimit + 1)
            .fetch(r -> toResponse(r, resolver));

    boolean hasMore = items.size() > safeLimit;
    if (hasMore) items = items.subList(0, safeLimit);
    String nextCursor = null;
    if (hasMore && !items.isEmpty()) {
      MessageResponse last = items.get(items.size() - 1);
      nextCursor = Cursor.encode(new Cursor(last.createdAt(), last.id()));
    }
    return new MessagePage(items, nextCursor, hasMore);
  }

  /**
   * Record → MessageResponse 변환. soft-deleted 메시지는 body 를 "(삭제됨)" 으로 마스킹. mentions 는 resolver 로
   * hydrate.
   */
  private MessageResponse toResponse(Record r, MentionResolver resolver) {
    boolean deleted = r.get(MESSAGE.DELETED_AT) != null;
    String body = deleted ? DELETED_BODY : r.get(MESSAGE.BODY);
    List<Long> mentionIds = fromJson(r.get(MESSAGE.MENTIONS));
    List<MentionResponse> mentions = resolver.resolve(mentionIds);
    OffsetDateTime created = r.get(MESSAGE.CREATED_AT);
    OffsetDateTime edited = r.get(MESSAGE.EDITED_AT);
    Integer replyCount = r.get("reply_count", Integer.class);
    return new MessageResponse(
        r.get(MESSAGE.ID),
        r.get(MESSAGE.CHANNEL_ID),
        r.get(MESSAGE.AUTHOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        body,
        mentions,
        r.get(MESSAGE.PARENT_MESSAGE_ID),
        replyCount == null ? 0 : replyCount,
        java.util.List.of(), // reactions 는 service 가 batch enrich
        java.util.List.of(), // attachments 는 service 가 batch enrich
        java.util.List.of(), // driveLinks 는 service 가 batch enrich
        created == null ? null : created.toInstant(),
        edited == null ? null : edited.toInstant(),
        deleted,
        0, // unreadReplyCount — service 가 enrich
        false); // followed — service 가 enrich
  }

  @SneakyThrows
  private String toJson(List<Long> ids) {
    return objectMapper.writeValueAsString(ids);
  }

  @SneakyThrows
  private List<Long> fromJson(JSONB jsonb) {
    if (jsonb == null) return List.of();
    // Jackson 은 List<Long> 타입 힌트 없이 읽으면 List<Integer> 로 반환한다.
    // 람다 진입 시 자동 (Long) checkcast 가 실패하므로 와일드카드로 받아 명시 변환.
    List<?> raw = objectMapper.readValue(jsonb.data(), List.class);
    return raw.stream().map(n -> ((Number) n).longValue()).toList();
  }

  /** mentionUserIds → MentionResponse[] 변환 책임. */
  public interface MentionResolver {
    List<MentionResponse> resolve(List<Long> mentionUserIds);
  }

  /**
   * Cursor record + 인코딩. base64(epochSecond|nano|id).
   *
   * <p>created_at(TIMESTAMPTZ)은 마이크로초 정밀도이므로 밀리초로 절단하면 같은 밀리초 내 메시지가 키셋 경계에서 영구 누락될 수 있다 (스크롤백 시 동일
   * 절단 커서 재생성 → 도달 불가). epochSecond + nano 로 풀 정밀도를 보존한다.
   */
  public record Cursor(Instant createdAt, long id) {
    public static String encode(Cursor c) {
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(
              (c.createdAt.getEpochSecond() + "|" + c.createdAt.getNano() + "|" + c.id)
                  .getBytes(StandardCharsets.UTF_8));
    }

    public static Cursor decode(String s) {
      String raw = new String(Base64.getUrlDecoder().decode(s), StandardCharsets.UTF_8);
      String[] parts = raw.split("\\|");
      return new Cursor(
          Instant.ofEpochSecond(Long.parseLong(parts[0]), Long.parseLong(parts[1])),
          Long.parseLong(parts[2]));
    }
  }
}
