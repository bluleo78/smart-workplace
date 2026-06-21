package com.workplace.chat.repository;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.USER;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.chat.dto.ChatMessagePage;
import com.workplace.chat.dto.ChatMessageResponse;
import com.workplace.global.dto.MentionResponse;
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
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.SelectConditionStep;
import org.springframework.stereotype.Repository;

/**
 * chat_message 리포지토리. cursor = base64(createdAt|id) DESC. soft-deleted 메시지는 body 를 "(삭제됨)" 으로 마스킹해
 * 응답에 포함 (UI 순서 보존).
 */
@Repository
@RequiredArgsConstructor
public class ChatMessageRepository {

  private static final String DELETED_BODY = "(삭제됨)";
  private static final int MAX_LIMIT = 100;

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /** 작성 후 ID 반환. mentions 는 user.id 의 long[] 형태로 저장. */
  public long insert(long threadId, long authorId, String body, List<Long> mentionUserIds) {
    JSONB jsonb = JSONB.valueOf(toJson(mentionUserIds));
    return dsl.insertInto(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.THREAD_ID, threadId)
        .set(CHAT_MESSAGE.AUTHOR_ID, authorId)
        .set(CHAT_MESSAGE.BODY, body)
        .set(CHAT_MESSAGE.MENTIONS, jsonb)
        .returning(CHAT_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** body 수정 + edited_at = now + mentions 재저장. */
  public void update(long id, String body, List<Long> mentionUserIds) {
    dsl.update(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.BODY, body)
        .set(CHAT_MESSAGE.MENTIONS, JSONB.valueOf(toJson(mentionUserIds)))
        .set(CHAT_MESSAGE.EDITED_AT, OffsetDateTime.now())
        .where(CHAT_MESSAGE.ID.eq(id))
        .execute();
  }

  /** soft-delete. */
  public void softDelete(long id) {
    dsl.update(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.DELETED_AT, OffsetDateTime.now())
        .where(CHAT_MESSAGE.ID.eq(id))
        .execute();
  }

  /** id 로 author_id 만 조회 (권한 체크용). soft-deleted 도 가져온다. */
  public Optional<Long> findAuthorId(long id) {
    return dsl.select(CHAT_MESSAGE.AUTHOR_ID)
        .from(CHAT_MESSAGE)
        .where(CHAT_MESSAGE.ID.eq(id))
        .fetchOptional(r -> r.get(CHAT_MESSAGE.AUTHOR_ID));
  }

  /** 메시지의 소속 thread_id 조회 (삭제 이벤트 fan-out 대상 산정용). */
  public java.util.Optional<Long> findThreadId(long messageId) {
    return dsl.select(CHAT_MESSAGE.THREAD_ID)
        .from(CHAT_MESSAGE)
        .where(CHAT_MESSAGE.ID.eq(messageId))
        .fetchOptional(CHAT_MESSAGE.THREAD_ID);
  }

  /** id 로 단건 조회. soft-deleted 도 body 마스킹해 반환. */
  public Optional<ChatMessageResponse> findById(long id, MentionResolver resolver) {
    return dsl.select(
            CHAT_MESSAGE.ID,
            CHAT_MESSAGE.THREAD_ID,
            CHAT_MESSAGE.AUTHOR_ID,
            USER.NAME,
            USER.KIND,
            CHAT_MESSAGE.BODY,
            CHAT_MESSAGE.MENTIONS,
            CHAT_MESSAGE.CREATED_AT,
            CHAT_MESSAGE.EDITED_AT,
            CHAT_MESSAGE.DELETED_AT)
        .from(CHAT_MESSAGE)
        .join(USER)
        .on(USER.ID.eq(CHAT_MESSAGE.AUTHOR_ID))
        .where(CHAT_MESSAGE.ID.eq(id))
        .fetchOptional(r -> toResponse(r, resolver));
  }

  /** thread 의 최근 N 개 메시지 DESC. cursor 없이. */
  public List<ChatMessageResponse> findRecent(long threadId, int limit, MentionResolver resolver) {
    return dsl.select(
            CHAT_MESSAGE.ID,
            CHAT_MESSAGE.THREAD_ID,
            CHAT_MESSAGE.AUTHOR_ID,
            USER.NAME,
            USER.KIND,
            CHAT_MESSAGE.BODY,
            CHAT_MESSAGE.MENTIONS,
            CHAT_MESSAGE.CREATED_AT,
            CHAT_MESSAGE.EDITED_AT,
            CHAT_MESSAGE.DELETED_AT)
        .from(CHAT_MESSAGE)
        .join(USER)
        .on(USER.ID.eq(CHAT_MESSAGE.AUTHOR_ID))
        .where(CHAT_MESSAGE.THREAD_ID.eq(threadId))
        .orderBy(CHAT_MESSAGE.CREATED_AT.desc(), CHAT_MESSAGE.ID.desc())
        .limit(Math.min(limit, MAX_LIMIT))
        .fetch(r -> toResponse(r, resolver));
  }

  /** Cursor 페이징. nextCursor 는 base64(createdAt|id). */
  public ChatMessagePage findPage(
      long threadId, String cursor, int limit, MentionResolver resolver) {
    int safeLimit = Math.min(limit, MAX_LIMIT);
    SelectConditionStep<?> query =
        dsl.select(
                CHAT_MESSAGE.ID,
                CHAT_MESSAGE.THREAD_ID,
                CHAT_MESSAGE.AUTHOR_ID,
                USER.NAME,
                USER.KIND,
                CHAT_MESSAGE.BODY,
                CHAT_MESSAGE.MENTIONS,
                CHAT_MESSAGE.CREATED_AT,
                CHAT_MESSAGE.EDITED_AT,
                CHAT_MESSAGE.DELETED_AT)
            .from(CHAT_MESSAGE)
            .join(USER)
            .on(USER.ID.eq(CHAT_MESSAGE.AUTHOR_ID))
            .where(CHAT_MESSAGE.THREAD_ID.eq(threadId));

    if (cursor != null && !cursor.isEmpty()) {
      Cursor c = Cursor.decode(cursor);
      OffsetDateTime cursorTs = OffsetDateTime.ofInstant(c.createdAt(), ZoneOffset.UTC);
      query =
          query.and(
              CHAT_MESSAGE
                  .CREATED_AT
                  .lessThan(cursorTs)
                  .or(CHAT_MESSAGE.CREATED_AT.eq(cursorTs).and(CHAT_MESSAGE.ID.lessThan(c.id()))));
    }

    List<ChatMessageResponse> items =
        query
            .orderBy(CHAT_MESSAGE.CREATED_AT.desc(), CHAT_MESSAGE.ID.desc())
            .limit(safeLimit + 1)
            .fetch(r -> toResponse(r, resolver));

    boolean hasMore = items.size() > safeLimit;
    if (hasMore) items = items.subList(0, safeLimit);
    String nextCursor = null;
    if (hasMore && !items.isEmpty()) {
      ChatMessageResponse last = items.get(items.size() - 1);
      nextCursor = Cursor.encode(new Cursor(last.createdAt(), last.id()));
    }
    return new ChatMessagePage(items, nextCursor, hasMore);
  }

  private ChatMessageResponse toResponse(Record r, MentionResolver resolver) {
    boolean deleted = r.get(CHAT_MESSAGE.DELETED_AT) != null;
    String body = deleted ? DELETED_BODY : r.get(CHAT_MESSAGE.BODY);
    List<Long> mentionIds = fromJson(r.get(CHAT_MESSAGE.MENTIONS));
    List<MentionResponse> mentions = resolver.resolve(mentionIds);
    OffsetDateTime created = r.get(CHAT_MESSAGE.CREATED_AT);
    OffsetDateTime edited = r.get(CHAT_MESSAGE.EDITED_AT);
    return new ChatMessageResponse(
        r.get(CHAT_MESSAGE.ID),
        r.get(CHAT_MESSAGE.THREAD_ID),
        r.get(CHAT_MESSAGE.AUTHOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        body,
        mentions,
        java.util.List.of(), // attachments — 서비스에서 하이드레이트
        java.util.List.of(), // driveLinks — 서비스에서 하이드레이트
        created == null ? null : created.toInstant(),
        edited == null ? null : edited.toInstant(),
        deleted);
  }

  /** 메시지가 해당 thread 소속인지 — 크로스-스레드 첨부 접근 차단용. */
  public boolean belongsToThread(long messageId, long threadId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CHAT_MESSAGE)
            .where(CHAT_MESSAGE.ID.eq(messageId))
            .and(CHAT_MESSAGE.THREAD_ID.eq(threadId)));
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
   * <p>createdAt 을 초+나노 풀 정밀도로 인코딩한다. 과거에는 toEpochMilli() 로 밀리초 미만을 절삭해, 동일 밀리초에 생성된 메시지가 커서
   * 경계(createdAt 동률 → id 비교)에 걸릴 때 누락될 수 있었다(메시지 유실). Postgres TIMESTAMPTZ 는 마이크로초까지 저장하므로, 절삭 시 같은
   * ms 안의 서로 다른 마이크로초 메시지가 동일 커서 시각으로 뭉개졌다. epochSecond|nano 로 DB 가 돌려준 정확한 시각을 보존한다.
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
