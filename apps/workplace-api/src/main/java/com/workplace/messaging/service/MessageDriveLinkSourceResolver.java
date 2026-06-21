// MessageDriveLinkSourceResolver.java — MESSAGE 백링크 라벨/딥링크/접근여부 해석
package com.workplace.messaging.service;

import static com.workplace.jooq.Tables.CHANNEL;
import static com.workplace.jooq.Tables.CHANNEL_MEMBER;
import static com.workplace.jooq.Tables.MESSAGE;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.drive.api.DriveLinkSourceResolver;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * MESSAGE 백링크 해석기. 라벨="#채널명 · 본문미리보기", 딥링크="/chat/channels/{channelId}". accessible = 호출자가 채널 멤버인지
 * 여부(SELECT 절 EXISTS 산출 — WHERE 필터 아님). 미존재/soft-deleted 메시지는 결과 맵에서 제외.
 */
@Component
@RequiredArgsConstructor
public class MessageDriveLinkSourceResolver implements DriveLinkSourceResolver {

  private static final int BODY_PREVIEW_LEN = 60;

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "MESSAGE";
  }

  @Override
  @Transactional(readOnly = true)
  public Map<Long, Resolved> resolve(long callerId, Collection<Long> sourceIds) {
    if (sourceIds == null || sourceIds.isEmpty()) return Map.of();

    // accessible 은 SELECT 절 EXISTS 로 산출 — WHERE 필터가 아님(비멤버는 accessible=false 로 반환)
    Field<Boolean> accessible =
        DSL.field(
            exists(
                selectOne()
                    .from(CHANNEL_MEMBER)
                    .where(
                        CHANNEL_MEMBER
                            .CHANNEL_ID
                            .eq(MESSAGE.CHANNEL_ID)
                            .and(CHANNEL_MEMBER.USER_ID.eq(callerId)))));

    List<Long> ids = List.copyOf(sourceIds);
    Map<Long, Resolved> out = new HashMap<>();

    dsl.select(MESSAGE.ID, MESSAGE.CHANNEL_ID, MESSAGE.BODY, CHANNEL.NAME, accessible)
        .from(MESSAGE)
        .join(CHANNEL)
        .on(CHANNEL.ID.eq(MESSAGE.CHANNEL_ID))
        .where(MESSAGE.ID.in(ids))
        .and(MESSAGE.DELETED_AT.isNull())
        .fetch(
            r -> {
              long msgId = r.get(MESSAGE.ID);
              long channelId = r.get(MESSAGE.CHANNEL_ID);
              // 채널 NAME 은 DM 시 null 가능 → 빈 문자열 처리
              String channelName = r.get(CHANNEL.NAME) != null ? r.get(CHANNEL.NAME) : "";
              String body = r.get(MESSAGE.BODY);
              String preview = bodyPreview(body);
              boolean acc = Boolean.TRUE.equals(r.get(accessible));
              String label = "#" + channelName + " · " + preview;
              String deepLink = "/chat/channels/" + channelId;
              out.put(msgId, new Resolved(label, deepLink, acc));
              return null;
            });

    return out;
  }

  /** 본문을 최대 BODY_PREVIEW_LEN 자로 잘라 미리보기 텍스트 생성. null/빈 본문은 빈 문자열. */
  private String bodyPreview(String body) {
    if (body == null || body.isBlank()) return "";
    return body.length() <= BODY_PREVIEW_LEN ? body : body.substring(0, BODY_PREVIEW_LEN) + "…";
  }
}
