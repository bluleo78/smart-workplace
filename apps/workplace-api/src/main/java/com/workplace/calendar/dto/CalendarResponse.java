package com.workplace.calendar.dto;

/**
 * 캘린더 응답. isReadOnly=true 이면 편집 불가(외부 읽기전용 컨테이너). accountEmail/provider 가 non-null 이면 외부 계정 연동
 * 캘린더(로컬은 둘 다 null). provider 는 email_account.provider 의 raw 문자열("M365_GRAPH"/"IMAP") — 모듈 경계상 mail
 * enum 을 쓰지 않는다.
 */
public record CalendarResponse(
    long id,
    String name,
    String color,
    boolean isDefault,
    int position,
    boolean isReadOnly,
    String accountEmail,
    String provider) {}
