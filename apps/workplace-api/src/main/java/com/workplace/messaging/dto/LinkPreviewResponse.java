package com.workplace.messaging.dto;

/**
 * 메시지 링크 미리보기 카드 1건(WP-874). position 은 본문에서 URL 이 나온 순서(0부터, 이미지 프록시 경로에 쓴다). 썸네일 원본 주소는 내보내지 않는다
 * — hasImage 가 true 면 웹이 {@code /messaging/messages/{id}/link-previews/{position}/image} 로 서버 프록시를
 * 거쳐 받는다(사용자 브라우저가 임의 외부 주소로 요청하지 않게).
 */
public record LinkPreviewResponse(
    int position,
    String url,
    String title,
    String description,
    String siteName,
    boolean hasImage) {}
