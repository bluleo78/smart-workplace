package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_COMMENT_REACTION;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.dto.CommentReactionResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * issue_comment_reaction 리포지토리(WP-504). 채팅 ReactionRepository 와 같은 모양 — (comment,user,emoji) 유니크라
 * add=ON CONFLICT DO NOTHING, remove=delete. 상한·권한 판정은 서비스가 이 조회들로 한다.
 */
@Repository
@RequiredArgsConstructor
public class IssueCommentReactionRepository {

  private final DSLContext dsl;

  /** 반응 추가. 이미 있으면 DO NOTHING. 실제 삽입됐으면 true(삽입됐을 때만 실시간 이벤트를 낸다). */
  public boolean add(long commentId, long userId, String emoji) {
    return dsl.insertInto(ISSUE_COMMENT_REACTION)
            .set(ISSUE_COMMENT_REACTION.COMMENT_ID, commentId)
            .set(ISSUE_COMMENT_REACTION.USER_ID, userId)
            .set(ISSUE_COMMENT_REACTION.EMOJI, emoji)
            .onConflictDoNothing()
            .execute()
        > 0;
  }

  /** 이 사람이 이 코멘트에 이미 단 반응인가(멱등 재요청은 상한 검사 없이 통과시킨다). */
  public boolean exists(long commentId, long userId, String emoji) {
    return dsl.fetchExists(ISSUE_COMMENT_REACTION, keyOf(commentId, userId, emoji));
  }

  /** 이 사람이 이 코멘트에 단 반응 수(1인 상한 판정용). */
  public int countByUser(long commentId, long userId) {
    return dsl.fetchCount(
        ISSUE_COMMENT_REACTION,
        ISSUE_COMMENT_REACTION
            .COMMENT_ID
            .eq(commentId)
            .and(ISSUE_COMMENT_REACTION.USER_ID.eq(userId)));
  }

  /** 이 코멘트에 emoji 가 이미 달려 있는가(종류 상한 — 이미 있는 이모지에 더하는 것은 종류를 늘리지 않는다). */
  public boolean hasEmoji(long commentId, String emoji) {
    return dsl.fetchExists(
        ISSUE_COMMENT_REACTION,
        ISSUE_COMMENT_REACTION
            .COMMENT_ID
            .eq(commentId)
            .and(ISSUE_COMMENT_REACTION.EMOJI.eq(emoji)));
  }

  /** 이 코멘트에 달린 서로 다른 이모지 수(종류 상한 판정용). */
  public int countDistinctEmojis(long commentId) {
    return dsl.fetchCount(
        dsl.selectDistinct(ISSUE_COMMENT_REACTION.EMOJI)
            .from(ISSUE_COMMENT_REACTION)
            .where(ISSUE_COMMENT_REACTION.COMMENT_ID.eq(commentId)));
  }

  /** 반응 취소. 실제 삭제됐으면 true. */
  public boolean remove(long commentId, long userId, String emoji) {
    return dsl.deleteFrom(ISSUE_COMMENT_REACTION).where(keyOf(commentId, userId, emoji)).execute()
        > 0;
  }

  /**
   * 여러 코멘트의 이모지별 집계를 1쿼리로 조회한다(코멘트 목록 N+1 방지). comment_id → [CommentReactionResponse...]. 이모지는 먼저
   * 달린 순, reacted = callerId 가 누른 이모지인지. 반응 없는 코멘트는 키가 없다.
   */
  public Map<Long, List<CommentReactionResponse>> summariesFor(
      Collection<Long> commentIds, long callerId) {
    Map<Long, List<CommentReactionResponse>> out = new HashMap<>();
    if (commentIds.isEmpty()) return out;
    dsl.select(
            ISSUE_COMMENT_REACTION.COMMENT_ID,
            ISSUE_COMMENT_REACTION.EMOJI,
            DSL.count().as("cnt"),
            DSL.boolOr(ISSUE_COMMENT_REACTION.USER_ID.eq(callerId)).as("reacted"))
        .from(ISSUE_COMMENT_REACTION)
        .where(ISSUE_COMMENT_REACTION.COMMENT_ID.in(commentIds))
        .groupBy(ISSUE_COMMENT_REACTION.COMMENT_ID, ISSUE_COMMENT_REACTION.EMOJI)
        .orderBy(ISSUE_COMMENT_REACTION.COMMENT_ID, DSL.min(ISSUE_COMMENT_REACTION.CREATED_AT))
        .fetch()
        .forEach(
            r ->
                out.computeIfAbsent(
                        r.get(ISSUE_COMMENT_REACTION.COMMENT_ID), k -> new ArrayList<>())
                    .add(
                        new CommentReactionResponse(
                            r.get(ISSUE_COMMENT_REACTION.EMOJI),
                            r.get("cnt", Integer.class),
                            Boolean.TRUE.equals(r.get("reacted", Boolean.class)))));
    return out;
  }

  /**
   * 코멘트의 특정 이모지 반응자를 먼저 누른 순(created_at, user_id)으로 limit+1 건 조회한다. 호출자는 limit+1 번째 존재로 hasMore 를
   * 판정한다. after 가 있으면 그 (created_at, user_id) 다음부터(키셋). user 를 조인해 이름·종류를 함께 준다.
   */
  public List<ReactorRow> findReactors(long commentId, String emoji, Cursor after, int limit) {
    Condition cond =
        ISSUE_COMMENT_REACTION.COMMENT_ID.eq(commentId).and(ISSUE_COMMENT_REACTION.EMOJI.eq(emoji));
    if (after != null)
      cond =
          cond.and(
              DSL.row(ISSUE_COMMENT_REACTION.CREATED_AT, ISSUE_COMMENT_REACTION.USER_ID)
                  .gt(OffsetDateTime.ofInstant(after.reactedAt(), ZoneOffset.UTC), after.userId()));
    return dsl.select(
            ISSUE_COMMENT_REACTION.USER_ID, ISSUE_COMMENT_REACTION.CREATED_AT, USER.NAME, USER.KIND)
        .from(ISSUE_COMMENT_REACTION)
        .join(USER)
        .on(USER.ID.eq(ISSUE_COMMENT_REACTION.USER_ID))
        .where(cond)
        .orderBy(ISSUE_COMMENT_REACTION.CREATED_AT, ISSUE_COMMENT_REACTION.USER_ID)
        .limit(limit + 1)
        .fetch(
            r ->
                new ReactorRow(
                    r.get(ISSUE_COMMENT_REACTION.USER_ID),
                    r.get(USER.NAME),
                    r.get(USER.KIND),
                    r.get(ISSUE_COMMENT_REACTION.CREATED_AT).toInstant()));
  }

  /** (코멘트, 사람, 이모지) 한 행을 가리키는 조건 — PK 와 같다. */
  private static Condition keyOf(long commentId, long userId, String emoji) {
    return ISSUE_COMMENT_REACTION
        .COMMENT_ID
        .eq(commentId)
        .and(ISSUE_COMMENT_REACTION.USER_ID.eq(userId))
        .and(ISSUE_COMMENT_REACTION.EMOJI.eq(emoji));
  }

  /** 반응자 1행 + 키셋 커서용 반응 시각. */
  public record ReactorRow(long userId, String name, String kind, Instant reactedAt) {}

  /**
   * 반응자 목록 키셋 커서(반응 시각, 사용자 id). 클라이언트에는 불투명 문자열로 준다 — 인코딩은 채팅 MessageRepository.Cursor 와 같은
   * base64url("초|나노|id").
   */
  public record Cursor(Instant reactedAt, long userId) {

    /** 불투명 문자열로 인코딩한다. */
    public String encode() {
      return Base64.getUrlEncoder()
          .withoutPadding()
          .encodeToString(
              (reactedAt.getEpochSecond() + "|" + reactedAt.getNano() + "|" + userId)
                  .getBytes(StandardCharsets.UTF_8));
    }

    /** 커서 해석. 깨진 값은 base64·숫자 파싱 원문 대신 한국어 안내의 IllegalArgumentException(→ 400)으로 바꾼다. */
    public static Cursor decode(String s) {
      try {
        String raw = new String(Base64.getUrlDecoder().decode(s), StandardCharsets.UTF_8);
        String[] parts = raw.split("\\|");
        return new Cursor(
            Instant.ofEpochSecond(Long.parseLong(parts[0]), Long.parseLong(parts[1])),
            Long.parseLong(parts[2]));
      } catch (RuntimeException e) {
        throw new IllegalArgumentException("목록 위치(cursor)가 올바르지 않습니다", e);
      }
    }
  }
}
