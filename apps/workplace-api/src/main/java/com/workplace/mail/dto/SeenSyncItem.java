package com.workplace.mail.dto;

/**
 * 메일 상태 역동기화 한 통 — 처리 시점 DB 의 값을 서버에 맞춘다(이벤트 값 아님). WP-187 읽음 전용이던 항목을 WP-1741 에서 별표까지 일반화했다.
 *
 * <p>속성마다 반영 대기가 따로라, 대기 중인 속성만 값을 싣고 대기가 아닌 속성은 null 이다 — 처리기는 null 이 아닌 속성만 서버에 보낸다(예: 읽음만 바뀌었으면
 * Graph 에 flag 를 보내지 않아 Outlook 의 「완료」 플래그를 덮지 않는다).
 *
 * @param seen 반영할 읽음 값, 읽음 반영 대기가 아니면 null
 * @param flagged 반영할 별표 값, 별표 반영 대기가 아니면 null
 */
public record SeenSyncItem(long messageId, ReadSyncLocator locator, Boolean seen, Boolean flagged) {

  /** 읽음만 반영하는 항목(기존 호출부·테스트 호환). */
  public SeenSyncItem(long messageId, ReadSyncLocator locator, boolean seen) {
    this(messageId, locator, Boolean.valueOf(seen), null);
  }
}
