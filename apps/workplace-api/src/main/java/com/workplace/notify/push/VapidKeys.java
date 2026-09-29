package com.workplace.notify.push;

import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;

/**
 * 서버 VAPID 키쌍. publicKeyBase64Url 은 브라우저 subscribe(applicationServerKey) 와 Authorization k= 에 그대로
 * 쓴다.
 */
public record VapidKeys(
    String publicKeyBase64Url, ECPublicKey publicKey, ECPrivateKey privateKey) {}
