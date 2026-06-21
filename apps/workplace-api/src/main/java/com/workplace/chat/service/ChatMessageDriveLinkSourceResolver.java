// ChatMessageDriveLinkSourceResolver.java — CHAT_MESSAGE 백링크 라벨/딥링크/접근여부 해석
package com.workplace.chat.service;

import static com.workplace.jooq.Tables.CHAT_MESSAGE;
import static com.workplace.jooq.Tables.CHAT_THREAD;
import static com.workplace.jooq.Tables.CHAT_THREAD_MEMBER;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
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
 * CHAT_MESSAGE 백링크 해석기. 라벨="{KEY}-{번호} · 본문미리보기", 딥링크="/projects/{KEY}/issues/{번호}". accessible =
 * 호출자가 thread 멤버인지(SELECT 절 EXISTS 산출 — WHERE 필터 아님). 미존재/soft-deleted 메시지는 결과 맵에서 제외(호출측에서 접근 불가로
 * 처리).
 */
@Component
@RequiredArgsConstructor
public class ChatMessageDriveLinkSourceResolver implements DriveLinkSourceResolver {

  private static final int BODY_PREVIEW_LEN = 60;

  private final DSLContext dsl;

  @Override
  public String sourceType() {
    return "CHAT_MESSAGE";
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
                    .from(CHAT_THREAD_MEMBER)
                    .where(
                        CHAT_THREAD_MEMBER
                            .THREAD_ID
                            .eq(CHAT_MESSAGE.THREAD_ID)
                            .and(CHAT_THREAD_MEMBER.USER_ID.eq(callerId)))));

    List<Long> ids = List.copyOf(sourceIds);
    Map<Long, Resolved> out = new HashMap<>();

    dsl.select(CHAT_MESSAGE.ID, CHAT_MESSAGE.BODY, PROJECT.KEY, ISSUE.NUMBER, accessible)
        .from(CHAT_MESSAGE)
        .join(CHAT_THREAD)
        .on(CHAT_THREAD.ID.eq(CHAT_MESSAGE.THREAD_ID))
        .join(ISSUE)
        .on(ISSUE.ID.eq(CHAT_THREAD.ISSUE_ID))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(CHAT_MESSAGE.ID.in(ids))
        .and(CHAT_MESSAGE.DELETED_AT.isNull())
        .fetch(
            r -> {
              long msgId = r.get(CHAT_MESSAGE.ID);
              String key = r.get(PROJECT.KEY);
              int num = r.get(ISSUE.NUMBER);
              String preview = bodyPreview(r.get(CHAT_MESSAGE.BODY));
              boolean acc = Boolean.TRUE.equals(r.get(accessible));
              // 라벨: "KEY-번호 · 본문미리보기" 형식
              String label = key + "-" + num + " · " + preview;
              // 딥링크: IssueDriveLinkSourceResolver 와 동일한 "/projects/KEY/issues/번호" 패턴
              String deepLink = "/projects/" + key + "/issues/" + num;
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
