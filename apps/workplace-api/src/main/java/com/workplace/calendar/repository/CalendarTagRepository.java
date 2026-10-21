package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_TAG;
import static com.workplace.jooq.Tables.CALENDAR_TAG;

import com.workplace.calendar.dto.CalendarTagRef;
import com.workplace.calendar.dto.CalendarTagResponse;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * calendar_tag·calendar_event_tag jOOQ 접근(WP-714·715). 테넌트 격리는 RLS(FORCE)가 보장하고, 사용자 격리(태그는 사람마다)는
 * 모든 조회에 user_id 조건을 거는 것으로 지킨다. 공개 구독 주소 조회만 테넌트 컨텍스트가 없어 SECURITY DEFINER 함수를 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class CalendarTagRepository {
  /** 연결 출처 — 앱에서 붙임. */
  public static final String SOURCE_APP = "APP";

  /** 연결 출처 — Outlook 범주 동기화. */
  public static final String SOURCE_OUTLOOK = "OUTLOOK";

  private final DSLContext dsl;

  /** 태그 한 행(주인 확인 뒤 서비스가 쓰는 값). feedToken 이 null 이면 구독 주소 없음. */
  public record TagRow(
      long id,
      long userId,
      String name,
      String color,
      String feedToken,
      OffsetDateTime feedCreatedAt) {}

  /** 공개 구독 주소 resolve 결과 — 토큰으로 찾은 태그와 그 테넌트·주인. */
  public record FeedTagRow(long id, long tenantId, long userId, String name) {}

  /**
   * 이름순 정렬 키 — 대소문자 무시 + 바이트 순서(C) 콜레이션. DB 기본 콜레이션은 환경마다 달라(로캘에 따라 한글이 영문보다 앞서기도 한다) 목록 순서가 흔들리므로
   * 고정한다: 영문·숫자가 먼저, 한글은 가나다순.
   */
  private static org.jooq.Field<String> nameOrder() {
    return DSL.lower(CALENDAR_TAG.NAME).collate(DSL.collation(DSL.name("C")));
  }

  /** 이 태그가 붙은 일정 수(연결 행 수) 집계식. */
  private static org.jooq.Field<Integer> eventCountField() {
    return DSL.field(
        DSL.selectCount()
            .from(CALENDAR_EVENT_TAG)
            .where(CALENDAR_EVENT_TAG.TAG_ID.eq(CALENDAR_TAG.ID)));
  }

  /** 이 태그에 Outlook 범주 동기화 연결이 하나라도 있는지 — 이름 바꾸기를 막는 기준(fromOutlook). */
  private static Condition outlookLinked(org.jooq.Field<Long> tagId) {
    return DSL.exists(
        DSL.selectOne()
            .from(CALENDAR_EVENT_TAG)
            .where(CALENDAR_EVENT_TAG.TAG_ID.eq(tagId))
            .and(CALENDAR_EVENT_TAG.SOURCE.eq(SOURCE_OUTLOOK)));
  }

  /** 목록·단건 응답 공통 select 결과 → 응답 DTO. */
  private static CalendarTagResponse toResponse(
      Record r, org.jooq.Field<Integer> count, org.jooq.Field<Boolean> fromOutlook) {
    return new CalendarTagResponse(
        r.get(CALENDAR_TAG.ID),
        r.get(CALENDAR_TAG.NAME),
        r.get(CALENDAR_TAG.COLOR),
        r.get(count),
        r.get(CALENDAR_TAG.FEED_TOKEN) != null,
        Boolean.TRUE.equals(r.get(fromOutlook)));
  }

  /** 내 태그 목록 — 이름순(대소문자 무시), 일정 수·구독 주소 여부·Outlook 출처 여부 포함. */
  public List<CalendarTagResponse> listByUser(long userId) {
    var count = eventCountField().as("event_count");
    var fromOutlook = DSL.field(outlookLinked(CALENDAR_TAG.ID)).as("from_outlook");
    return dsl.select(
            CALENDAR_TAG.ID,
            CALENDAR_TAG.NAME,
            CALENDAR_TAG.COLOR,
            CALENDAR_TAG.FEED_TOKEN,
            count,
            fromOutlook)
        .from(CALENDAR_TAG)
        .where(CALENDAR_TAG.USER_ID.eq(userId))
        .orderBy(nameOrder(), CALENDAR_TAG.ID)
        .fetch(r -> toResponse(r, count, fromOutlook));
  }

  /** 태그 하나 + 일정 수(응답용). 주인이 아니면 빈 값. */
  public Optional<CalendarTagResponse> findResponse(long userId, long tagId) {
    var count = eventCountField().as("event_count");
    var fromOutlook = DSL.field(outlookLinked(CALENDAR_TAG.ID)).as("from_outlook");
    return dsl.select(
            CALENDAR_TAG.ID,
            CALENDAR_TAG.NAME,
            CALENDAR_TAG.COLOR,
            CALENDAR_TAG.FEED_TOKEN,
            count,
            fromOutlook)
        .from(CALENDAR_TAG)
        .where(CALENDAR_TAG.ID.eq(tagId))
        .and(CALENDAR_TAG.USER_ID.eq(userId))
        .fetchOptional(r -> toResponse(r, count, fromOutlook));
  }

  /** 주인 확인 조회 — 남의 태그·없는 태그는 빈 값(서비스가 404 로 은닉). */
  public Optional<TagRow> findOwned(long userId, long tagId) {
    return dsl.selectFrom(CALENDAR_TAG)
        .where(CALENDAR_TAG.ID.eq(tagId))
        .and(CALENDAR_TAG.USER_ID.eq(userId))
        .fetchOptional(
            r ->
                new TagRow(
                    r.getId(),
                    r.getUserId(),
                    r.getName(),
                    r.getColor(),
                    r.getFeedToken(),
                    r.getFeedCreatedAt()));
  }

  /** 이 태그가 붙은 일정 수. */
  public int countEvents(long tagId) {
    return dsl.fetchCount(CALENDAR_EVENT_TAG, CALENDAR_EVENT_TAG.TAG_ID.eq(tagId));
  }

  /** 이 태그에 Outlook 범주 동기화 연결이 있는지 — 있으면 앱에서 이름을 못 바꾼다. */
  public boolean hasOutlookLinks(long tagId) {
    return dsl.fetchValue(DSL.field(outlookLinked(DSL.val(tagId))));
  }

  /** 이 사용자에게 같은 이름(대소문자 무시)의 다른 태그가 있는지 — excludeTagId 는 이름을 바꾸는 그 태그 자신(null 이면 제외 없음). */
  public boolean existsName(long userId, String name, Long excludeTagId) {
    var cond =
        CALENDAR_TAG
            .USER_ID
            .eq(userId)
            .and(DSL.lower(CALENDAR_TAG.NAME).eq(DSL.lower(DSL.val(name))));
    if (excludeTagId != null) cond = cond.and(CALENDAR_TAG.ID.ne(excludeTagId));
    return dsl.fetchExists(CALENDAR_TAG, cond);
  }

  /** 태그 생성 — 같은 이름(대소문자 무시)이 있으면 유니크 인덱스가 DuplicateKeyException 을 던진다(서비스가 409 로). */
  public long insert(long userId, String name, String color) {
    return dsl.insertInto(CALENDAR_TAG)
        .set(CALENDAR_TAG.USER_ID, userId)
        .set(CALENDAR_TAG.NAME, name)
        .set(CALENDAR_TAG.COLOR, color)
        .returning(CALENDAR_TAG.ID)
        .fetchOne()
        .getId();
  }

  /** 이름·색 갱신(null 은 그대로). 이름 충돌은 DuplicateKeyException. */
  public void update(long tagId, String name, String color) {
    var q = dsl.update(CALENDAR_TAG).set(CALENDAR_TAG.UPDATED_AT, OffsetDateTime.now());
    if (name != null) q = q.set(CALENDAR_TAG.NAME, name);
    if (color != null) q = q.set(CALENDAR_TAG.COLOR, color);
    q.where(CALENDAR_TAG.ID.eq(tagId)).execute();
  }

  /** 태그 삭제 — 연결은 FK CASCADE 로 함께 사라지고, 구독 주소 토큰도 행째 없어진다. */
  public void delete(long tagId) {
    dsl.deleteFrom(CALENDAR_TAG).where(CALENDAR_TAG.ID.eq(tagId)).execute();
  }

  /** 주어진 id 중 이 사용자 것인 태그 id 집합 — PUT 요청에 남의 태그가 섞였는지 가린다. */
  public Set<Long> ownedIds(long userId, Collection<Long> tagIds) {
    if (tagIds.isEmpty()) return Set.of();
    return new HashSet<>(
        dsl.select(CALENDAR_TAG.ID)
            .from(CALENDAR_TAG)
            .where(CALENDAR_TAG.USER_ID.eq(userId))
            .and(CALENDAR_TAG.ID.in(tagIds))
            .fetch(CALENDAR_TAG.ID));
  }

  /**
   * 일정들(키 = 마스터 또는 단일 일정 id)에 붙은 이 사용자의 태그 — 목록 응답 N+1 을 피하는 배치 조회. 일정마다 이름순(대소문자 무시).
   *
   * @return event_id → 태그 목록(태그가 없는 일정은 키 없음)
   */
  public Map<Long, List<CalendarTagRef>> tagsByEvents(long userId, Collection<Long> eventIds) {
    Map<Long, List<CalendarTagRef>> out = new HashMap<>();
    if (eventIds.isEmpty()) return out;
    dsl.select(CALENDAR_EVENT_TAG.EVENT_ID, CALENDAR_TAG.ID, CALENDAR_TAG.NAME, CALENDAR_TAG.COLOR)
        .from(CALENDAR_EVENT_TAG)
        .join(CALENDAR_TAG)
        .on(CALENDAR_TAG.ID.eq(CALENDAR_EVENT_TAG.TAG_ID))
        .where(CALENDAR_TAG.USER_ID.eq(userId))
        .and(CALENDAR_EVENT_TAG.EVENT_ID.in(eventIds))
        .orderBy(nameOrder(), CALENDAR_TAG.ID)
        .fetch()
        .forEach(
            r ->
                out.computeIfAbsent(r.get(CALENDAR_EVENT_TAG.EVENT_ID), k -> new ArrayList<>())
                    .add(
                        new CalendarTagRef(
                            r.get(CALENDAR_TAG.ID),
                            r.get(CALENDAR_TAG.NAME),
                            r.get(CALENDAR_TAG.COLOR))));
    return out;
  }

  /**
   * 한 일정의 이 사용자 APP 연결을 tagIds 와 같게 맞춘다 — 빠진 것은 지우고 새 것은 넣는다. 다른 사람의 태그 연결과 OUTLOOK 연결은 건드리지 않는다.
   * tagIds 는 모두 이 사용자 것이라고 서비스가 확인한 뒤 부른다.
   */
  public void replaceAppLinks(long userId, long eventId, Collection<Long> tagIds) {
    var mine =
        DSL.select(CALENDAR_TAG.ID).from(CALENDAR_TAG).where(CALENDAR_TAG.USER_ID.eq(userId));
    var del =
        CALENDAR_EVENT_TAG
            .EVENT_ID
            .eq(eventId)
            .and(CALENDAR_EVENT_TAG.SOURCE.eq(SOURCE_APP))
            .and(CALENDAR_EVENT_TAG.TAG_ID.in(mine));
    if (!tagIds.isEmpty()) del = del.and(CALENDAR_EVENT_TAG.TAG_ID.notIn(tagIds));
    dsl.deleteFrom(CALENDAR_EVENT_TAG).where(del).execute();
    insertLinks(eventId, tagIds, SOURCE_APP);
  }

  /** 한 일정에 여러 태그 연결을 넣는다 — 이미 있는 (tag, event) 는 건드리지 않는다. */
  private void insertLinks(long eventId, Collection<Long> tagIds, String source) {
    if (tagIds.isEmpty()) return;
    var insert =
        dsl.insertInto(
            CALENDAR_EVENT_TAG,
            CALENDAR_EVENT_TAG.TAG_ID,
            CALENDAR_EVENT_TAG.EVENT_ID,
            CALENDAR_EVENT_TAG.SOURCE);
    for (Long tagId : tagIds) {
      insert = insert.values(tagId, eventId, source);
    }
    insert.onConflictDoNothing().execute();
  }

  /**
   * 일정의 모든 태그 연결(모든 사용자·출처)을 다른 일정으로 복사 — 반복 일정을 「이후 모든 일정」으로 나눠 새 마스터가 생길 때 참석자 복사와 같이 태그도 이어지게
   * 한다.
   */
  public void copyLinks(long fromEventId, long toEventId) {
    dsl.insertInto(
            CALENDAR_EVENT_TAG,
            CALENDAR_EVENT_TAG.TAG_ID,
            CALENDAR_EVENT_TAG.EVENT_ID,
            CALENDAR_EVENT_TAG.SOURCE)
        .select(
            DSL.select(CALENDAR_EVENT_TAG.TAG_ID, DSL.val(toEventId), CALENDAR_EVENT_TAG.SOURCE)
                .from(CALENDAR_EVENT_TAG)
                .where(CALENDAR_EVENT_TAG.EVENT_ID.eq(fromEventId)))
        .onConflictDoNothing()
        .execute();
  }

  // ── Outlook 범주 동기화 ────────────────────────────────────────────────────

  /**
   * 범주 이름들을 이 사용자의 태그 id 로 바꾼다 — 없는 이름은 만든다(색 = colorOf(이름)). 키는 넘겨받은 이름 그대로다.
   *
   * <p>대소문자 접기는 DB 의 {@code lower()} 한 곳에서만 한다 — 이름 유일 인덱스가 {@code lower(name)} 이라, Java {@code
   * toLowerCase} 로 키를 만들면 일부 비ASCII 이름(그리스어 끝 시그마 「ΟΔΟΣ」, 터키어 「İ」 등)에서 둘이 달라져 범주가 연결되지 못하고 동기화마다 다시
   * 넣으려 한다. 그래서 입력을 {@code unnest} 로 넘겨 SQL 안에서 {@code lower(tag.name) = lower(input)} 으로 맞춘다.
   *
   * <p>없는 이름은 대상 없는 {@code ON CONFLICT DO NOTHING} 으로 넣고 같은 매칭을 다시 한다 — 그 사이 사용자가 같은 이름을 앱에서 만들어도
   * 충돌 없이 그 태그를 쓴다. 대소문자만 다른 두 범주가 한 번에 들어와도 유일 인덱스가 하나만 남기고, 둘 다 그 태그로 매칭된다.
   */
  public Map<String, Long> findOrCreateByNames(
      long userId, Collection<String> names, java.util.function.Function<String, String> colorOf) {
    Map<String, Long> out = new HashMap<>();
    if (names.isEmpty()) return out;
    String[] input = names.toArray(String[]::new);
    matchByName(userId, input, out);
    if (out.size() < input.length) {
      var insert =
          dsl.insertInto(CALENDAR_TAG, CALENDAR_TAG.USER_ID, CALENDAR_TAG.NAME, CALENDAR_TAG.COLOR);
      for (String n : input) {
        if (!out.containsKey(n)) insert = insert.values(userId, n, colorOf.apply(n));
      }
      insert.onConflictDoNothing().execute();
      matchByName(userId, input, out);
    }
    return out;
  }

  /** 입력 이름마다 이 사용자의 같은 이름(DB lower 기준) 태그 id 를 out 에 채운다 — 없는 이름은 키가 없다. */
  private void matchByName(long userId, String[] names, Map<String, Long> out) {
    dsl.resultQuery(
            "SELECT input.n AS input_name, t.id AS tag_id"
                + " FROM unnest(?::text[]) AS input(n)"
                + " JOIN calendar_tag t ON lower(t.name) = lower(input.n)"
                + " WHERE t.user_id = ?",
            names,
            userId)
        .fetch()
        .forEach(r -> out.put(r.get("input_name", String.class), r.get("tag_id", Long.class)));
  }

  /** 일정들의 이 사용자 OUTLOOK 연결 — event_id → tag_id 집합. */
  public Map<Long, Set<Long>> outlookLinks(long userId, Collection<Long> eventIds) {
    Map<Long, Set<Long>> out = new HashMap<>();
    if (eventIds.isEmpty()) return out;
    dsl.select(CALENDAR_EVENT_TAG.EVENT_ID, CALENDAR_EVENT_TAG.TAG_ID)
        .from(CALENDAR_EVENT_TAG)
        .join(CALENDAR_TAG)
        .on(CALENDAR_TAG.ID.eq(CALENDAR_EVENT_TAG.TAG_ID))
        .where(CALENDAR_TAG.USER_ID.eq(userId))
        .and(CALENDAR_EVENT_TAG.SOURCE.eq(SOURCE_OUTLOOK))
        .and(CALENDAR_EVENT_TAG.EVENT_ID.in(eventIds))
        .fetch()
        .forEach(
            r ->
                out.computeIfAbsent(r.get(CALENDAR_EVENT_TAG.EVENT_ID), k -> new HashSet<>())
                    .add(r.get(CALENDAR_EVENT_TAG.TAG_ID)));
    return out;
  }

  /** 일정-태그 연결 한 쌍 — Outlook 범주 동기화가 바뀐 연결을 모아 한 번에 지우고 넣을 때 쓴다. */
  public record EventTagLink(long eventId, long tagId) {}

  /**
   * OUTLOOK 연결 여러 쌍을 한 문장으로 지운다(달력 동기화 한 번에 DELETE 하나). 같은 쌍의 APP 연결은 남긴다. 쌍 목록은 {@code unnest} 배열
   * 두 개로 넘겨 일정 수가 많아도 바인드 변수가 늘지 않는다.
   */
  public void deleteOutlookLinks(Collection<EventTagLink> links) {
    if (links.isEmpty()) return;
    dsl.execute(
        "DELETE FROM calendar_event_tag"
            + " WHERE source = ?"
            + " AND (event_id, tag_id) IN (SELECT * FROM unnest(?::bigint[], ?::bigint[]))",
        SOURCE_OUTLOOK,
        eventIdsOf(links),
        tagIdsOf(links));
  }

  /** OUTLOOK 연결 여러 쌍을 한 문장으로 넣는다 — 이미 있는 (tag, event) 는 출처와 상관없이 그대로 둔다. tenant_id 는 컬럼 기본값. */
  public void insertOutlookLinks(Collection<EventTagLink> links) {
    if (links.isEmpty()) return;
    dsl.execute(
        "INSERT INTO calendar_event_tag (tag_id, event_id, source)"
            + " SELECT l.tag_id, l.event_id, ? FROM unnest(?::bigint[], ?::bigint[]) AS l(event_id, tag_id)"
            + " ON CONFLICT DO NOTHING",
        SOURCE_OUTLOOK,
        eventIdsOf(links),
        tagIdsOf(links));
  }

  private static Long[] eventIdsOf(Collection<EventTagLink> links) {
    return links.stream().map(EventTagLink::eventId).toArray(Long[]::new);
  }

  private static Long[] tagIdsOf(Collection<EventTagLink> links) {
    return links.stream().map(EventTagLink::tagId).toArray(Long[]::new);
  }

  // ── 구독 주소(WP-715) ─────────────────────────────────────────────────────

  /** 구독 주소 토큰 저장(발급·재발급) — 이전 토큰은 덮어써져 바로 무효가 된다. */
  public void setFeedToken(long tagId, String token, OffsetDateTime createdAt) {
    dsl.update(CALENDAR_TAG)
        .set(CALENDAR_TAG.FEED_TOKEN, token)
        .set(CALENDAR_TAG.FEED_CREATED_AT, createdAt)
        .set(CALENDAR_TAG.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_TAG.ID.eq(tagId))
        .execute();
  }

  /** 구독 주소 폐기. */
  public void clearFeedToken(long tagId) {
    dsl.update(CALENDAR_TAG)
        .setNull(CALENDAR_TAG.FEED_TOKEN)
        .setNull(CALENDAR_TAG.FEED_CREATED_AT)
        .set(CALENDAR_TAG.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_TAG.ID.eq(tagId))
        .execute();
  }

  /**
   * 공개 구독 주소 토큰 → 태그·테넌트·주인. 테넌트 컨텍스트가 없는 공개 요청에서 부르므로 SECURITY DEFINER 함수({@code
   * calendar_tag_feed_resolve}, V196)로 RLS 를 우회한다.
   */
  public Optional<FeedTagRow> resolveFeedToken(String token) {
    return Optional.ofNullable(
            dsl.resultQuery(
                    "SELECT id, tenant_id, user_id, name FROM calendar_tag_feed_resolve(?)", token)
                .fetchOne())
        .map(
            r ->
                new FeedTagRow(
                    r.get("id", Long.class),
                    r.get("tenant_id", Long.class),
                    r.get("user_id", Long.class),
                    r.get("name", String.class)));
  }
}
