package com.workplace.messaging.repository;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.CONVERSATION_ATTENTION;
import static com.workplace.jooq.Tables.MESSAGE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.messaging.dto.ConversationRow;
import com.workplace.messaging.dto.DmParticipant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 홈 대시보드 대화 요약 전용 조회. 읽기 전용(서비스가 @Transactional 경계 소유). */
@Repository
@RequiredArgsConstructor
public class MessagingSummaryRepository {

  private final DSLContext dsl;

  /**
   * 본인 워터마크(channel_member.last_read_message_id) 이후, 본인 외 작성, 스레드 답글 제외 = 안읽음. CHANNEL.ID 와
   * CHANNEL_MEMBER 가 이미 조인된 쿼리 컨텍스트에서만 호출. SELECT 절용(alias 포함).
   */
  private static org.jooq.Field<Integer> unreadCountField(long callerId) {
    return unreadCountScalar(callerId).asField("unread_count");
  }

  /** 안읽음 수 스칼라 서브쿼리(alias 없음). WHERE/HAVING 절에서 alias 참조 오류 회피용. */
  private static org.jooq.SelectConditionStep<org.jooq.Record1<Integer>> unreadCountScalar(
      long callerId) {
    return DSL.selectCount()
        .from(MESSAGE)
        .where(
            MESSAGE
                .CHANNEL_ID
                .eq(CHANNEL.ID)
                .and(MESSAGE.DELETED_AT.isNull())
                .and(MESSAGE.PARENT_MESSAGE_ID.isNull())
                .and(MESSAGE.AUTHOR_ID.ne(callerId))
                .and(
                    MESSAGE.ID.gt(
                        DSL.coalesce(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, DSL.inline(0L)))));
  }

  /**
   * 최근 대화 후보 — 마지막 메시지 id 상위 K(recency). 마지막 메시지 작성자/본문 포함. 2단계 조회(N+1 회피): 1) 후보 채널+안읽음 수, 2) 마지막
   * 메시지 배치 조인.
   */
  public List<ConversationRow> recentConversationRows(long callerId, int candidateLimit) {
    // 마지막 메시지 id 서브쿼리(상관 서브쿼리 — base fetch 시 채널별 평가됨)
    var lastId =
        dsl.select(DSL.max(MESSAGE.ID))
            .from(MESSAGE)
            .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID).and(MESSAGE.DELETED_AT.isNull()))
            .asField("last_message_id");

    // 1단계: 후보 대화 + 마지막 메시지 id + 안읽음 수.
    var base =
        dsl.select(CHANNEL.ID, CHANNEL.KIND, CHANNEL.NAME, lastId, unreadCountField(callerId))
            .from(CHANNEL)
            .join(CHANNEL_MEMBER)
            .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
            .where(CHANNEL.ARCHIVED_AT.isNull())
            .and(CHANNEL.KIND.in("CHANNEL", "DM"))
            .orderBy(DSL.field(DSL.name("last_message_id")).desc().nullsLast())
            .limit(candidateLimit)
            .fetch();

    List<Long> lastIds =
        base.stream()
            .map(r -> r.get("last_message_id", Long.class))
            .filter(Objects::nonNull)
            .toList();

    // 2단계: 마지막 메시지 작성자·본문·시각을 단일 쿼리로 배치 조회(N+1 회피).
    Map<Long, ? extends org.jooq.Record> lastById =
        lastIds.isEmpty()
            ? Map.of()
            : dsl.select(MESSAGE.ID, MESSAGE.AUTHOR_ID, MESSAGE.BODY, MESSAGE.CREATED_AT, USER.NAME)
                .from(MESSAGE)
                .join(USER)
                .on(USER.ID.eq(MESSAGE.AUTHOR_ID))
                .where(MESSAGE.ID.in(lastIds))
                .fetchMap(MESSAGE.ID);

    return base.stream()
        .map(
            r -> {
              Long lid = r.get("last_message_id", Long.class);
              Record msg = lid == null ? null : lastById.get(lid);
              Long authorId = msg == null ? null : msg.get(MESSAGE.AUTHOR_ID);
              String body = msg == null ? null : msg.get(MESSAGE.BODY);
              var at = msg == null ? null : msg.get(MESSAGE.CREATED_AT);
              String authorName = msg == null ? null : msg.get(USER.NAME);
              Integer unread = r.get("unread_count", Integer.class);
              return new ConversationRow(
                  r.get(CHANNEL.ID),
                  r.get(CHANNEL.KIND),
                  r.get(CHANNEL.NAME),
                  lid,
                  at == null ? null : at.toInstant(),
                  authorId,
                  authorName,
                  body,
                  unread == null ? 0 : unread);
            })
        .toList();
  }

  /** 안 읽은(워터마크 이후) 메시지 중 callerId 를 멘션한 대화 id 집합. mentions @> [callerId]. */
  public Set<Long> mentionedChannelIds(List<Long> channelIds, long callerId) {
    if (channelIds.isEmpty()) return Set.of();
    JSONB needle = JSONB.valueOf("[" + callerId + "]");
    return dsl.selectDistinct(MESSAGE.CHANNEL_ID)
        .from(MESSAGE)
        .join(CHANNEL_MEMBER)
        .on(
            CHANNEL_MEMBER
                .CHANNEL_ID
                .eq(MESSAGE.CHANNEL_ID)
                .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
        .where(MESSAGE.CHANNEL_ID.in(channelIds))
        .and(MESSAGE.DELETED_AT.isNull())
        .and(MESSAGE.ID.gt(DSL.coalesce(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, DSL.inline(0L))))
        // 자기 멘션(셀프 @mention) 제외 — unreadCountScalar 와 동일 기준
        .and(MESSAGE.AUTHOR_ID.ne(callerId))
        // 스레드 답글 멘션은 채널 워터마크가 아닌 스레드 읽음 상태로 판정해야 함 — 최상위 메시지만
        .and(MESSAGE.PARENT_MESSAGE_ID.isNull())
        .and(DSL.condition("{0} @> {1}", MESSAGE.MENTIONS, DSL.val(needle)))
        .fetchSet(MESSAGE.CHANNEL_ID);
  }

  /** DM 참가자 배치 조회(채널 id → 참가자 목록). dmDisplayName 용. */
  public Map<Long, List<DmParticipant>> participantsByChannel(List<Long> channelIds) {
    if (channelIds.isEmpty()) return Map.of();
    return dsl.select(CHANNEL_MEMBER.CHANNEL_ID, USER.ID, USER.NAME, USER.KIND)
        .from(CHANNEL_MEMBER)
        .join(USER)
        .on(USER.ID.eq(CHANNEL_MEMBER.USER_ID))
        .where(CHANNEL_MEMBER.CHANNEL_ID.in(channelIds))
        .fetchGroups(
            r -> r.get(CHANNEL_MEMBER.CHANNEL_ID),
            r -> new DmParticipant(r.get(USER.ID), r.get(USER.NAME), r.get(USER.KIND)));
  }

  /** 안읽음(>0) 대화 수(헤더 "안읽음 N"). */
  public long countUnreadConversations(long callerId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(CHANNEL)
            .join(CHANNEL_MEMBER)
            .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
            .where(CHANNEL.ARCHIVED_AT.isNull())
            .and(CHANNEL.KIND.in("CHANNEL", "DM"))
            .and(unreadCountScalar(callerId).asField().gt(0)));
  }

  /**
   * 회신 대기 대화 수(헤더 "회신 대기 N"). 전역 집계 — recency 후보 K 캡과 무관. 회신 대기 = (DM 이며 안읽음>0) OR (안읽은 멘션 존재).
   * channel_member 조인이 caller 당 1행이라 채널당 한 번만 세어지므로 DISTINCT 불필요(멘션 있는 DM 이중계산 방지).
   */
  public long countNeedsReply(long callerId) {
    JSONB needle = JSONB.valueOf("[" + callerId + "]");
    org.jooq.Condition dmUnread =
        CHANNEL.KIND.eq("DM").and(unreadCountScalar(callerId).asField().gt(0));
    org.jooq.Condition hasUnreadMention =
        DSL.exists(
            dsl.selectOne()
                .from(MESSAGE)
                .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID))
                .and(MESSAGE.DELETED_AT.isNull())
                .and(
                    MESSAGE.ID.gt(
                        DSL.coalesce(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, DSL.inline(0L))))
                // 자기 멘션(셀프 @mention) 제외 — unreadCountScalar 와 동일 기준
                .and(MESSAGE.AUTHOR_ID.ne(callerId))
                // 스레드 답글 멘션은 채널 워터마크 기준이 아닌 스레드 읽음 상태로 판정해야 함 — 최상위만
                .and(MESSAGE.PARENT_MESSAGE_ID.isNull())
                .and(DSL.condition("{0} @> {1}", MESSAGE.MENTIONS, DSL.val(needle))));
    return dsl.fetchCount(
        dsl.selectOne()
            .from(CHANNEL)
            .join(CHANNEL_MEMBER)
            .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
            .where(CHANNEL.ARCHIVED_AT.isNull())
            .and(CHANNEL.KIND.in("CHANNEL", "DM"))
            .and(dmUnread.or(hasUnreadMention)));
  }

  /**
   * "확인 필요" 대화 수(KPI 단일값) — 회신 대기 ∪ AI 발굴 안읽음의 합집합 distinct 채널 수. KPI 가 needsReplyCount +
   * aiAttentionCount 를 단순 합산하면 한 채널이 두 신호를 모두 가질 때 이중 집계되므로, 합집합을 한 쿼리로 dedup 해 센다.
   *
   * <p>합집합 조건: (DM 이며 안읽음>0) OR (안읽은 멘션 존재) OR (AI 발굴 마크 존재 AND 안읽음>0). channel_member 조인이
   * caller 당 채널마다 1행이라 채널당 한 번만 세어지므로 DISTINCT 불필요(countNeedsReply 와 동일 보장).
   *
   * <p>AI 마크 분기는 inner join 이 아닌 EXISTS 로 작성 — join 으로 묶으면 마크 없는 DM/멘션 채널이 결과에서 탈락한다.
   */
  public long countAttentionConversations(long callerId) {
    JSONB needle = JSONB.valueOf("[" + callerId + "]");
    org.jooq.Condition dmUnread =
        CHANNEL.KIND.eq("DM").and(unreadCountScalar(callerId).asField().gt(0));
    org.jooq.Condition hasUnreadMention =
        DSL.exists(
            dsl.selectOne()
                .from(MESSAGE)
                .where(MESSAGE.CHANNEL_ID.eq(CHANNEL.ID))
                .and(MESSAGE.DELETED_AT.isNull())
                .and(
                    MESSAGE.ID.gt(
                        DSL.coalesce(CHANNEL_MEMBER.LAST_READ_MESSAGE_ID, DSL.inline(0L))))
                // 자기 멘션(셀프 @mention) 제외 — unreadCountScalar 와 동일 기준
                .and(MESSAGE.AUTHOR_ID.ne(callerId))
                // 스레드 답글 멘션은 채널 워터마크 기준이 아닌 스레드 읽음 상태로 판정 — 최상위만
                .and(MESSAGE.PARENT_MESSAGE_ID.isNull())
                .and(DSL.condition("{0} @> {1}", MESSAGE.MENTIONS, DSL.val(needle))));
    org.jooq.Condition aiMarkUnread =
        DSL.exists(
                dsl.selectOne()
                    .from(CONVERSATION_ATTENTION)
                    .where(CONVERSATION_ATTENTION.CHANNEL_ID.eq(CHANNEL.ID))
                    .and(CONVERSATION_ATTENTION.USER_ID.eq(callerId)))
            .and(unreadCountScalar(callerId).asField().gt(0));
    return dsl.fetchCount(
        dsl.selectOne()
            .from(CHANNEL)
            .join(CHANNEL_MEMBER)
            .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
            .where(CHANNEL.ARCHIVED_AT.isNull())
            .and(CHANNEL.KIND.in("CHANNEL", "DM"))
            .and(dmUnread.or(hasUnreadMention).or(aiMarkUnread)));
  }

  /**
   * AI 발굴 마크가 있고 callerId 에게 여전히 안읽음인 대화 수(헤더 "AI 주목 N"). 전역 집계 — recency 후보 K 캡과 무관.
   * countNeedsReply 의 안읽음 판정(unreadCountScalar) 패턴 재사용.
   */
  public long countAiAttentionUnread(long callerId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(CHANNEL)
            .join(CHANNEL_MEMBER)
            .on(CHANNEL_MEMBER.CHANNEL_ID.eq(CHANNEL.ID).and(CHANNEL_MEMBER.USER_ID.eq(callerId)))
            .join(CONVERSATION_ATTENTION)
            .on(
                CONVERSATION_ATTENTION
                    .CHANNEL_ID
                    .eq(CHANNEL.ID)
                    .and(CONVERSATION_ATTENTION.USER_ID.eq(callerId)))
            .where(CHANNEL.ARCHIVED_AT.isNull())
            .and(CHANNEL.KIND.in("CHANNEL", "DM"))
            .and(unreadCountScalar(callerId).asField().gt(0)));
  }
}
