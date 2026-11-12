package com.workplace.mail.util;

import org.jooq.Field;
import org.jooq.impl.DSL;

/**
 * Message-ID 꺾쇠 처리 한곳 — 같은 Message-ID 가 꺾쇠 없이(IMAP 파서·앱이 저장한 보낸 사본) 또는 꺾쇠를 붙여(Graph 동기화 사본) 저장되므로
 * 비교할 때 앞뒤 꺾쇠를 뗀다.
 */
public final class MessageIds {

  private MessageIds() {}

  /**
   * SQL 비교식 {@code btrim(message_id, '<>')}. 인덱스 idx_email_message_account_msgid(V217) ·
   * idx_email_content_genia_sent_msgid(V287) 의 식과 글자 그대로 같아야 인덱스를 탄다 — 바꾸면 두 인덱스도 함께 바꾼다.
   */
  public static Field<String> bare(Field<String> messageId) {
    return DSL.field("btrim({0}, '<>')", String.class, messageId);
  }

  /** Java 쪽 같은 규칙 — 앞뒤 공백과 꺾쇠를 뗀다. null 은 null. */
  public static String bare(String messageId) {
    return messageId == null ? null : messageId.strip().replaceAll("^<+|>+$", "");
  }
}
