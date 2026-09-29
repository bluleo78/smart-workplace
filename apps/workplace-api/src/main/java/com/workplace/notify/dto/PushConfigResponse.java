package com.workplace.notify.dto;

/** 푸시 사용 가능 여부와 VAPID 공개키. enabled=false(폐쇄망)면 vapidPublicKey=null — 프론트는 푸시 UI 를 숨긴다. */
public record PushConfigResponse(boolean enabled, String vapidPublicKey) {}
