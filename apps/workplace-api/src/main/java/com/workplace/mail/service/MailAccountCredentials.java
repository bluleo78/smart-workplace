package com.workplace.mail.service;

import com.workplace.global.exception.CryptoException;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * IMAP/SMTP 계정 비밀번호 확보(WP-574) — 짧은 읽기 트랜잭션에서 조회·복호화만 한다. 전송기(SMTP)와 Sent APPEND 는 트랜잭션 밖에서 불려(전송
 * 동안 DB 연결을 잡지 않는다) I/O 만 맡고, RLS GUC 가 필요한 조회는 여기로 모은다. 호출자 트랜잭션이 있으면 거기에 합류한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailAccountCredentials {

  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EncryptionService encryption;

  /**
   * 내 계정의 평문 비밀번호.
   *
   * @throws EmailAccountNotFoundException 내 계정이 아니거나 비밀번호가 없음
   * @throws MailSyncException 저장된 암호문을 복호화하지 못함(502, WP-1892)
   */
  @Transactional(readOnly = true)
  public String password(long userId, long accountId) {
    String encrypted =
        accountRepo
            .findEncryptedPassword(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    return decrypt(accountId, encrypted);
  }

  /**
   * 저장된 암호문을 복호화한다(WP-1892) — 메일 경로가 같은 컬럼을 직접 복호화하다 500/400 으로 새지 않도록 매핑을 한 곳에 둔다. 트랜잭션이 필요 없다.
   *
   * @throws MailSyncException 암호문 형식 오류·키 불일치로 복호화하지 못함(502)
   */
  public String decrypt(long accountId, String encrypted) {
    try {
      return encryption.decrypt(encrypted);
    } catch (CryptoException | IllegalArgumentException e) {
      // 암호문 형식 오류·키 불일치는 500/400 으로 새지 않게 설계된 502 + 한국어 안내로 돌린다.
      // 로그에는 계정 id 와 예외 종류만 남긴다(암호문·키 정보 노출 방지).
      log.warn("메일 계정 비밀번호 복호화 실패 accountId={} cause={}", accountId, e.getClass().getSimpleName());
      throw new MailSyncException(MailServerErrors.CREDENTIAL_UNREADABLE, e);
    }
  }

  /** 지난 동기화에서 찾은 서버 보낸편지함 이름(WP-950) — Sent APPEND 가 전체 폴더 목록(LIST)보다 먼저 확인한다. 없으면 null. */
  @Transactional(readOnly = true)
  public String serverSentFolderName(long accountId) {
    return folderRepo.findServerSentName(accountId).orElse(null);
  }
}
