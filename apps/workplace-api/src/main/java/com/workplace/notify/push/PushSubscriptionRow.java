package com.workplace.notify.push;

/** push_subscription 1행 — 발송에 필요한 필드만. p256dh/auth 는 브라우저가 준 base64url 그대로. */
public record PushSubscriptionRow(
    long id, long userId, String endpoint, String p256dh, String auth) {}
