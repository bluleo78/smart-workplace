package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Row2;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 받는사람 자동완성(WP-945)의 최근 수신인 원천 — 내 계정들의 보낸편지함(SENT) 행의 수신자 헤더.
 *
 * <p>email_account·email_message 는 RLS 라 호출자의 테넌트 트랜잭션 안에서 부른다. 소유는 account.user_id 로 건다.
 */
@Repository
@RequiredArgsConstructor
public class MailRecipientRepository {

  /** 보낸 메일 한 통의 수신자 헤더(저장된 그대로 — 주소만이거나 「이름 &lt;주소&gt;」). */
  public record SentHeaders(String to, String cc, String bcc, OffsetDateTime sentAt) {}

  private final DSLContext dsl;

  /**
   * 내 모든 계정의 보낸 메일을 최근 보낸 순으로 limit 통까지 — 수신자 헤더와 보낸 시각만.
   *
   * <p>먼저 내 SENT 폴더(계정·폴더 id 쌍)를 찾고 그 쌍으로 거른다 — 고유 인덱스 (account_id, folder_id, imap_uid) 앞부분으로 보낸
   * 메일만 바로 찾게 해, 받은편지함 행을 훑지 않는다. 정렬은 그 안에서만 한다.
   */
  public List<SentHeaders> listRecentSent(long userId, int limit) {
    List<Row2<Long, Long>> sentFolders =
        dsl.select(EMAIL_FOLDER.ACCOUNT_ID, EMAIL_FOLDER.ID)
            .from(EMAIL_FOLDER)
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_FOLDER.ACCOUNT_ID))
            .where(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_FOLDER.NAME.eq("SENT"))
            .fetch(r -> DSL.row(r.value1(), r.value2()));
    if (sentFolders.isEmpty()) {
      return List.of();
    }
    return dsl.select(
            EMAIL_MESSAGE.TO_ADDRESSES,
            EMAIL_MESSAGE.CC_ADDRESSES,
            EMAIL_MESSAGE.BCC_ADDRESSES,
            EMAIL_MESSAGE.RECEIVED_AT)
        .from(EMAIL_MESSAGE)
        .where(DSL.row(EMAIL_MESSAGE.ACCOUNT_ID, EMAIL_MESSAGE.FOLDER_ID).in(sentFolders))
        // 보낸 메일은 received_at 에도 보낸 시각을 넣는다(insertSentRow).
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(r -> new SentHeaders(r.value1(), r.value2(), r.value3(), r.value4()));
  }
}
