package com.workplace.calendar.dto;

/**
 * 태그 생성·수정 요청(WP-714). 수정은 바꿀 필드만 보낸다(null = 그대로). 생성에서 color 를 빼면 이름 해시로 정한다.
 *
 * <p>이름 길이(앞뒤 공백을 뗀 1~50자)는 서비스가 검사한다 — Bean Validation 은 공백을 떼기 전 값을 보기 때문이다.
 */
public record CalendarTagRequest(String name, String color) {}
