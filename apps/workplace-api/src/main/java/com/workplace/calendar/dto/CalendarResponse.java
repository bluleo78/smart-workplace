package com.workplace.calendar.dto;

/**
 * 캘린더 응답. isReadOnly=true 이면 편집 불가(외부 읽기전용 컨테이너). accountEmail/provider 가 non-null 이면 외부 계정 연동
 * 캘린더(로컬은 둘 다 null). provider 는 email_account.provider 의 raw 문자열("M365_GRAPH"/"IMAP") — 모듈 경계상 mail
 * enum 을 쓰지 않는다.
 *
 * <p>tagsWritable: 이 캘린더에 태그를 붙여 일정을 만들 수 있는지. 로컬 캘린더(외부 계정 없음)이거나 본인 메일함(is_own_mailbox) 외부 캘린더면
 * true, 공유 외부 캘린더는 false — 서버 생성 검사(WP-801, `!isOwnMailbox`)와 같은 기준이라 웹이 태그 입력을 미리 막는다 (WP-2172).
 */
public record CalendarResponse(
    long id,
    String name,
    String color,
    boolean isDefault,
    int position,
    boolean isReadOnly,
    String accountEmail,
    String provider,
    boolean tagsWritable) {}
