package com.workplace.search.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.util.LikePatternUtils;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 통합 검색 팔레트(WP-1358)의 메시지 본문 검색 — 호출자가 멤버인 채널·DM 의 메시지만 본문 부분 일치(ILIKE, 와일드카드 이스케이프)로 찾는다. 보관된
 * 채널·삭제된 메시지·본문 없는(첨부만) 메시지는 빼고, 스레드 답글과 AI(AGENT) 가 보낸 메시지는 포함한다. 최신순(created_at DESC, id DESC) 키셋
 * 페이지로 이어 받는다. message 는 RLS 표라 트라이그램 인덱스가 쓰이지 않아(WP-1353 EXPLAIN) 인덱스는 두지 않는다 — 내 채널로 먼저 좁혀지는 조인에
 * 기댄다.
 */
@Repository
@RequiredArgsConstructor
public class MessageSearchRepository {

  private final DSLContext dsl;

  /** 검색 결과 한 행 — 원문 본문(발췌·멘션 치환은 서비스 몫)과 화면에 필요한 채널·작성자 정보. */
  public record Row(
      long id,
      long channelId,
      String channelKind,
      String channelName,
      Long parentMessageId,
      String authorName,
      String authorKind,
      String body,
      OffsetDateTime createdAt) {}

  /**
   * 본문에 q 가 들어간 메시지를 limit 건 읽는다(호출자가 hasMore 판정을 위해 size+1 을 넘긴다).
   *
   * @param callerId 이 사용자가 멤버(channel_member)인 채널·DM 만 대상
   * @param q 이미 strip 한 검색어 — 와일드카드(%, _, \)는 여기서 이스케이프해 글자 그대로 찾는다
   * @param beforeAt 다음 쪽 커서의 시각(이전 쪽 마지막 행). beforeId 와 함께 있을 때만 쓴다
   * @param beforeId 다음 쪽 커서의 id(같은 시각 안에서 가르는 키)
   */
  public List<Row> search(long callerId, String q, Instant beforeAt, Long beforeId, int limit) {
    Condition where =
        CHANNEL
            .ARCHIVED_AT
            .isNull()
            // 채널·DM 만 — 다른 종류가 생겨도 대화 딥링크가 틀어지지 않게 명시한다.
            .and(CHANNEL.KIND.in("CHANNEL", "DM"))
            .and(MESSAGE.DELETED_AT.isNull())
            .and(MESSAGE.BODY.isNotNull())
            .and(MESSAGE.BODY.likeIgnoreCase(LikePatternUtils.containsPattern(q), '\\'));
    if (beforeAt != null && beforeId != null) {
      // 키셋: (created_at, id) 가 커서보다 앞(더 오래된) 행만 — 정렬 키와 같은 튜플 비교라 경계 행이 빠지거나 겹치지 않는다.
      where =
          where.and(
              DSL.row(MESSAGE.CREATED_AT, MESSAGE.ID)
                  .lt(OffsetDateTime.ofInstant(beforeAt, ZoneOffset.UTC), beforeId));
    }
    return dsl.select(
            MESSAGE.ID,
            MESSAGE.CHANNEL_ID,
            CHANNEL.KIND,
            CHANNEL.NAME,
            MESSAGE.PARENT_MESSAGE_ID,
            USER.NAME,
            USER.KIND,
            MESSAGE.BODY,
            MESSAGE.CREATED_AT)
        .from(MESSAGE)
        .join(CHANNEL)
        .on(CHANNEL.ID.eq(MESSAGE.CHANNEL_ID))
        // 멤버십 판정은 ChannelMemberRepository.isMember 와 같은 기준(channel_member 행 존재).
        .join(CHANNEL_MEMBER)
        .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
        .join(USER)
        .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
        .where(where)
        .orderBy(MESSAGE.CREATED_AT.desc(), MESSAGE.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new Row(
                    r.get(MESSAGE.ID),
                    r.get(MESSAGE.CHANNEL_ID),
                    r.get(CHANNEL.KIND),
                    r.get(CHANNEL.NAME),
                    r.get(MESSAGE.PARENT_MESSAGE_ID),
                    r.get(USER.NAME),
                    r.get(USER.KIND),
                    r.get(MESSAGE.BODY),
                    r.get(MESSAGE.CREATED_AT)));
  }
}
