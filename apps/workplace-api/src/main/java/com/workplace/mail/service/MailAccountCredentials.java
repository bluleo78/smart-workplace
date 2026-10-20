package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * IMAP/SMTP 계정 비밀번호 확보(WP-574) — 짧은 읽기 트랜잭션에서 조회·복호화만 한다. 전송기(SMTP)와 Sent APPEND 는 트랜잭션 밖에서 불려(전송
 * 동안 DB 연결을 잡지 않는다) I/O 만 맡고, RLS GUC 가 필요한 조회는 여기로 모은다. 호출자 트랜잭션이 있으면 거기에 합류한다.
 */
@Service
@RequiredArgsConstructor
public class MailAccountCredentials {

  private final EmailAccountRepository accountRepo;
  private final EncryptionService encryption;

  /**
   * 내 계정의 평문 비밀번호.
   *
   * @throws EmailAccountNotFoundException 내 계정이 아니거나 비밀번호가 없음
   */
  @Transactional(readOnly = true)
  public String password(long userId, long accountId) {
    return accountRepo
        .findEncryptedPassword(userId, accountId)
        .map(encryption::decrypt)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
  }
}
