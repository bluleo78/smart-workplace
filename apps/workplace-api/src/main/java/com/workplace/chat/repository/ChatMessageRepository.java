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
import org.jooq.Condition;
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

  /** 응답 매핑(toResponse)에 필요한 컬럼 — 모든 메시지 조회가 같은 목록을 쓴다. */
  private static final org.jooq.SelectField<?>[] MESSAGE_FIELDS = {
    CHAT_MESSAGE.ID,
    CHAT_MESSAGE.THREAD_ID,
    CHAT_MESSAGE.AUTHOR_ID,
    USER.NAME,
    USER.USERNAME,
    USER.KIND,
    CHAT_MESSAGE.BODY,
    CHAT_MESSAGE.MENTIONS,
    CHAT_MESSAGE.CREATED_AT,
    CHAT_MESSAGE.EDITED_AT,
    CHAT_MESSAGE.DELETED_AT,
    CHAT_MESSAGE.IS_QUESTION
  };

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /** 작성 후 ID 반환(일반 글 — 질문 아님). */
  public long insert(long threadId, long authorId, String body, List<Long> mentionUserIds) {
    return insert(threadId, authorId, body, mentionUserIds, false);
  }

  /**
   * 작성 후 ID 반환. mentions 는 user.id 의 long[] 형태로 저장. question 은 AI 구성원이 답변 필요로 멈추며 남긴 글인지(WP-373) —
   * 생성과 같은 INSERT 에 넣어 생성 이벤트·SSE 가 저장값과 같은 값을 보게 한다(예전 사후 markQuestion 은 이벤트가 저장 전 값으로 나갔다).
   */
  public long insert(
      long threadId, long authorId, String body, List<Long> mentionUserIds, boolean question) {
    JSONB jsonb = JSONB.valueOf(toJson(mentionUserIds));
    return dsl.insertInto(CHAT_MESSAGE)
        .set(CHAT_MESSAGE.THREAD_ID, threadId)
        .set(CHAT_MESSAGE.AUTHOR_ID, authorId)
        .set(CHAT_MESSAGE.BODY, body)
        .set(CHAT_MESSAGE.MENTIONS, jsonb)
        .set(CHAT_MESSAGE.IS_QUESTION, question)
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
    return dsl.select(MESSAGE_FIELDS)
        .from(CHAT_MESSAGE)
        .join(USER)
        .on(USER.ID.eq(CHAT_MESSAGE.AUTHOR_ID))
        .where(CHAT_MESSAGE.ID.eq(id))
        .fetchOptional(r -> toResponse(r, resolver));
  }

  /** 정렬 키 (created_at, id) — after·afterMine 조회의 기준점. */
  private record Anchor(OffsetDateTime createdAt, long id) {}

  /** 이 스레드의 메시지 기준점. 다른 스레드이거나 없으면 empty. */
  private Optional<Anchor> anchorOf(long threadId, long messageId) {
    return dsl.select(CHAT_MESSAGE.CREATED_AT, CHAT_MESSAGE.ID)
        .from(CHAT_MESSAGE)
        .where(CHAT_MESSAGE.ID.eq(messageId).and(CHAT_MESSAGE.THREAD_ID.eq(threadId)))
        .fetchOptional(r -> new Anchor(r.value1(), r.value2()));
  }

  /** 호출자의 삭제되지 않은 마지막 글 기준점(WP-373 — pendingForMe 와 같은 "내 마지막 글" 정의). */
  private Optional<Anchor> lastOwnAnchor(long threadId, long authorId) {
    return dsl.select(CHAT_MESSAGE.CREATED_AT, CHAT_MESSAGE.ID)
        .from(CHAT_MESSAGE)
        .where(CHAT_MESSAGE.THREAD_ID.eq(threadId))
        .and(CHAT_MESSAGE.AUTHOR_ID.eq(authorId))
        .and(CHAT_MESSAGE.DELETED_AT.isNull())
        .orderBy(CHAT_MESSAGE.CREATED_AT.desc(), CHAT_MESSAGE.ID.desc())
        .limit(1)
        .fetchOptional(r -> new Anchor(r.value1(), r.value2()));
  }

  private static Condition afterAnchor(Anchor a) {
    return CHAT_MESSAGE
        .CREATED_AT
        .gt(a.createdAt())
        .or(CHAT_MESSAGE.CREATED_AT.eq(a.createdAt()).and(CHAT_MESSAGE.ID.gt(a.id())));
  }

  private static Condition beforeAnchor(Anchor a) {
    return CHAT_MESSAGE
        .CREATED_AT
        .lt(a.createdAt())
        .or(CHAT_MESSAGE.CREATED_AT.eq(a.createdAt()).and(CHAT_MESSAGE.ID.lt(a.id())));
  }

  /** 스레드의 메시지 + 작성자 조인 select — 모든 목록 조회가 공유한다. */
  private SelectConditionStep<?> selectInThread(long threadId) {
    return dsl.select(MESSAGE_FIELDS)
        .from(CHAT_MESSAGE)
        .join(USER)
        .on(USER.ID.eq(CHAT_MESSAGE.AUTHOR_ID))
        .where(CHAT_MESSAGE.THREAD_ID.eq(threadId));
  }

  /** limit+1 개로 받은 오름차순 목록을 페이지로 — 넘치면 hasMore, 다음 after 는 마지막 메시지 id. */
  private static ChatMessagePage ascendingPage(
      List<ChatMessageResponse> head, List<ChatMessageResponse> rest, int limit) {
    boolean hasMore = rest.size() > limit;
    List<ChatMessageResponse> body = hasMore ? rest.subList(0, limit) : rest;
    List<ChatMessageResponse> items = new java.util.ArrayList<>(head);
    items.addAll(body);
    String next = hasMore ? String.valueOf(body.get(body.size() - 1).id()) : null;
    return new ChatMessagePage(items, next, hasMore);
  }

  /**
   * after 메시지보다 뒤의 글을 오름차순으로(WP-373 — 외부 AI 가 새 글만 읽는다). after 가 이 스레드의 글이 아니면
   * IllegalArgumentException(400).
   */
  public ChatMessagePage findAfter(
      long threadId, long afterId, int limit, MentionResolver resolver) {
    Anchor a =
        anchorOf(threadId, afterId)
            .orElseThrow(() -> new IllegalArgumentException("after 메시지가 이 대화에 없습니다: " + afterId));
    List<ChatMessageResponse> rest =
        selectInThread(threadId)
            .and(afterAnchor(a))
            .orderBy(CHAT_MESSAGE.CREATED_AT.asc(), CHAT_MESSAGE.ID.asc())
            .limit(limit + 1)
            .fetch(r -> toResponse(r, resolver));
    return ascendingPage(List.of(), rest, limit);
  }

  /** afterMine 앞에 붙이는 맥락 글 수(스펙 §3.3). */
  private static final int MINE_CONTEXT = 5;

  /** 호출자의 마지막 글 기준 "직전 5개 + 그 글부터 최대 limit 개"(오름차순). 호출자 글이 없으면 최신 limit 개를 오름차순으로. */
  public ChatMessagePage findAroundOwnLast(
      long threadId, long callerId, int limit, MentionResolver resolver) {
    Optional<Anchor> mine = lastOwnAnchor(threadId, callerId);
    if (mine.isEmpty()) {
      List<ChatMessageResponse> latest =
          new java.util.ArrayList<>(
              selectInThread(threadId)
                  .orderBy(CHAT_MESSAGE.CREATED_AT.desc(), CHAT_MESSAGE.ID.desc())
                  .limit(limit)
                  .fetch(r -> toResponse(r, resolver)));
      java.util.Collections.reverse(latest);
      return new ChatMessagePage(latest, null, false);
    }
    Anchor a = mine.get();
    List<ChatMessageResponse> context =
        new java.util.ArrayList<>(
            selectInThread(threadId)
                .and(beforeAnchor(a))
                .orderBy(CHAT_MESSAGE.CREATED_AT.desc(), CHAT_MESSAGE.ID.desc())
                .limit(MINE_CONTEXT)
                .fetch(r -> toResponse(r, resolver)));
    java.util.Collections.reverse(context);
    List<ChatMessageResponse> rest =
        selectInThread(threadId)
            .and(afterAnchor(a).or(CHAT_MESSAGE.ID.eq(a.id())))
            .orderBy(CHAT_MESSAGE.CREATED_AT.asc(), CHAT_MESSAGE.ID.asc())
            .limit(limit + 1)
            .fetch(r -> toResponse(r, resolver));
    return ascendingPage(context, rest, limit);
  }

  /** Cursor 페이징. nextCursor 는 base64(createdAt|id). */
  public ChatMessagePage findPage(
      long threadId, String cursor, int limit, MentionResolver resolver) {
    int safeLimit = Math.min(limit, MAX_LIMIT);
    SelectConditionStep<?> query = selectInThread(threadId);

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
        deleted,
        r.get(USER.USERNAME),
        // 삭제된 질문은 강조하지 않는다(스펙 §3.1).
        !deleted && Boolean.TRUE.equals(r.get(CHAT_MESSAGE.IS_QUESTION)));
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

  /**
   * AI 요약 입력용 경량 조회 — 멘션 하이드레이션 없이 작성자명·kind·본문·시각만, 삭제 제외, 오름차순.
   *
   * @param threadId 조회 대상 chat_thread.id
   * @param limit 최대 조회 건수 (MAX_LIMIT 이 상한)
   */
  public List<SummaryLine> findForSummary(long threadId, int limit) {
    return dsl.select(USER.NAME, USER.KIND, CHAT_MESSAGE.BODY, CHAT_MESSAGE.CREATED_AT)
        .from(CHAT_MESSAGE)
        .join(USER)
        .on(USER.ID.eq(CHAT_MESSAGE.AUTHOR_ID))
        .where(CHAT_MESSAGE.THREAD_ID.eq(threadId).and(CHAT_MESSAGE.DELETED_AT.isNull()))
        .orderBy(CHAT_MESSAGE.CREATED_AT.asc(), CHAT_MESSAGE.ID.asc())
        .limit(Math.min(limit, MAX_LIMIT))
        .fetch(
            r ->
                new SummaryLine(
                    r.get(USER.NAME),
                    r.get(USER.KIND),
                    r.get(CHAT_MESSAGE.BODY),
                    toInstant(r.get(CHAT_MESSAGE.CREATED_AT))));
  }

  /** findForSummary 결과 1줄(chat 모듈 내부 표현). */
  public record SummaryLine(String authorName, String authorKind, String body, Instant createdAt) {}

  /** OffsetDateTime → Instant 변환 헬퍼. null-safe. */
  private static Instant toInstant(OffsetDateTime odt) {
    return odt == null ? null : odt.toInstant();
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
