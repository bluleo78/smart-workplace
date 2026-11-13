package com.workplace.drive.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.util.CapabilityTokens;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * 공유 링크 토큰 암호문 다루기(WP-1528·WP-1539) — 평문 토큰은 저장하지 않고 AES-GCM 암호문으로만 둔다. 링크 목록(다시 복사)과 공유받은 항목(다시
 * 열기·복사)이 같은 규칙으로 되살린다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ShareLinkTokenCodec {
  private final EncryptionService encryption;

  /** 평문 토큰 → 저장할 암호문. */
  public String encrypt(String token) {
    return encryption.encrypt(token);
  }

  /**
   * 암호문을 평문으로 풀고 링크의 token_hash 와 맞는지 확인한다. 암호문이 없거나(WP-1528 이전 링크) 풀리지 않거나(키 교체·손상) 해시가 다르면(다른 행
   * 암호문이 옮겨진 경우 등 — 엉뚱한 URL 을 복사하게 하지 않는다) null — 호출부의 목록 전체가 실패하지 않게 한다. 로그에는 링크 id 만 남기고 토큰·암호문
   * 값은 남기지 않는다.
   */
  public String restore(String tokenEncrypted, String tokenHash, long linkId) {
    if (tokenEncrypted == null) {
      return null;
    }
    String token;
    try {
      token = encryption.decrypt(tokenEncrypted);
    } catch (RuntimeException e) {
      log.warn("공유 링크 토큰 복호화 실패 linkId={}", linkId);
      return null;
    }
    if (!CapabilityTokens.sha256Hex(token).equals(tokenHash)) {
      log.warn("공유 링크 토큰 해시 불일치 linkId={}", linkId);
      return null;
    }
    return token;
  }
}
