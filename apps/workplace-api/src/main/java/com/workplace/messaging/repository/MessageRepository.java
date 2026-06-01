package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;

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
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.SelectConditionStep;
import org.springframework.stereotype.Repository;

/**
 * message 리포지토리. cursor = base64(epochSecond|nano|id) DESC. soft-deleted 메시지는 body 를 "(삭제됨)" 으로
 * 마스킹해 응답에 포함 (UI 순서 보존). Phase 1: mention resolver 없음.
 */
@Repository
@RequiredArgsConstructor
public class MessageRepository {

  private static final String DELETED_BODY = "(삭제됨)";
  private static final int MAX_LIMIT = 100;

  private final DSLContext dsl;

  /** 메시지 작성 후 ID 반환. */
  public long insert(long channelId, long authorId, String body) {
    return dsl.insertInto(MESSAGE)
        .set(MESSAGE.CHANNEL_ID, channelId)
        .set(MESSAGE.AUTHOR_ID, authorId)
        .set(MESSAGE.BODY, body)
        .returning(MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** id 로 단건 조회. soft-deleted 도 body 마스킹해 반환. */
  public Optional<MessageResponse> findById(long id) {
    return dsl.select(
            MESSAGE.ID,
            MESSAGE.CHANNEL_ID,
            MESSAGE.AUTHOR_ID,
            USER.NAME,
            USER.KIND,
            MESSAGE.BODY,
            MESSAGE.CREATED_AT,
            MESSAGE.EDITED_AT,
            MESSAGE.DELETED_AT)
        .from(MESSAGE)
        .join(USER)
        .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
        .where(MESSAGE.ID.eq(id))
        .fetchOptional(this::toResponse);
  }

  /** Cursor 페이징. nextCursor 는 base64(epochSecond|nano|id). DESC 정렬. */
  public MessagePage findPage(long channelId, String cursor, int limit) {
    int safeLimit = Math.min(limit, MAX_LIMIT);
    SelectConditionStep<?> query =
        dsl.select(
                MESSAGE.ID,
                MESSAGE.CHANNEL_ID,
                MESSAGE.AUTHOR_ID,
                USER.NAME,
                USER.KIND,
                MESSAGE.BODY,
                MESSAGE.CREATED_AT,
                MESSAGE.EDITED_AT,
                MESSAGE.DELETED_AT)
            .from(MESSAGE)
            .join(USER)
            .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
            .where(MESSAGE.CHANNEL_ID.eq(channelId));

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
            .fetch(this::toResponse);

    boolean hasMore = items.size() > safeLimit;
    if (hasMore) items = items.subList(0, safeLimit);
    String nextCursor = null;
    if (hasMore && !items.isEmpty()) {
      MessageResponse last = items.get(items.size() - 1);
      nextCursor = Cursor.encode(new Cursor(last.createdAt(), last.id()));
    }
    return new MessagePage(items, nextCursor, hasMore);
  }

  /** Record → MessageResponse 변환. soft-deleted 메시지는 body 를 "(삭제됨)" 으로 마스킹. */
  private MessageResponse toResponse(Record r) {
    boolean deleted = r.get(MESSAGE.DELETED_AT) != null;
    String body = deleted ? DELETED_BODY : r.get(MESSAGE.BODY);
    OffsetDateTime created = r.get(MESSAGE.CREATED_AT);
    OffsetDateTime edited = r.get(MESSAGE.EDITED_AT);
    return new MessageResponse(
        r.get(MESSAGE.ID),
        r.get(MESSAGE.CHANNEL_ID),
        r.get(MESSAGE.AUTHOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        body,
        created == null ? null : created.toInstant(),
        edited == null ? null : edited.toInstant(),
        deleted);
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
