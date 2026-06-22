package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.ConnectionTestResult;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.exception.DuplicateEmailAccountException;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailConnectionException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.repository.EmailAccountRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 계정 CRUD 오케스트레이션. 모든 작업은 callerId(=본인) 스코프. 생성/수정은 저장 전 IMAP/SMTP 연결을 실제로 검증하고 통과해야만 영속화한다.
 * 비밀번호 평문은 이 계층에서만 잠깐 다뤄 EncryptionService 로 암호화한 뒤 저장한다.
 */
@Service
@RequiredArgsConstructor
public class EmailAccountService {

  private final EmailAccountRepository repo;
  private final EncryptionService encryption;
  private final MailConnectionTester tester;

  /** 본인 계정 목록. */
  @Transactional(readOnly = true)
  public List<EmailAccountResponse> list(long userId) {
    return repo.listByUser(userId);
  }

  /** 저장 없이 연결만 테스트(등록 폼의 [연결 테스트] 버튼). 비밀번호는 요청 본문 값을 그대로 사용한다. */
  @Transactional(readOnly = true)
  public ConnectionTestResult test(EmailAccountRequest req) {
    return runTest(req, req.password());
  }

  /**
   * 기존 계정의 [연결 테스트] — 수정 폼은 보안상 비밀번호를 미리 채우지 않으므로, 비밀번호가 비어 있으면 저장된 암호문을 복호화해 사용한다(update() 와 동일
   * 폴백). 본인 소유가 아니거나 없는 계정이면 404. 이를 통해 동기화는 되는데 테스트만 인증 실패하던 비대칭(#448)을 제거한다.
   */
  @Transactional(readOnly = true)
  public ConnectionTestResult test(long userId, long id, EmailAccountRequest req) {
    String storedEnc =
        repo.findEncryptedPassword(userId, id)
            .orElseThrow(() -> new EmailAccountNotFoundException(id));
    String effectivePassword =
        isBlank(req.password()) ? encryption.decrypt(storedEnc) : req.password();
    return runTest(req, effectivePassword);
  }

  /** 계정 등록 — 비밀번호 필수, 중복 금지, 연결 테스트 통과 필수. */
  @Transactional
  public EmailAccountResponse create(long userId, EmailAccountRequest req) {
    if (isBlank(req.password())) {
      throw new MailValidationException("비밀번호를 입력하세요");
    }
    if (repo.existsByUserAndAddress(userId, req.emailAddress())) {
      throw new DuplicateEmailAccountException(req.emailAddress());
    }
    ConnectionTestResult result = runTest(req, req.password());
    if (!result.success()) {
      throw new MailConnectionException(result);
    }
    long id = repo.insert(userId, req, encryption.encrypt(req.password()));
    return repo.findByIdAndUser(userId, id).orElseThrow();
  }

  /** 계정 수정 — 비밀번호 빈 값이면 기존 유지. 연결 테스트 통과 필수. 본인 소유 아니면 404. */
  @Transactional
  public EmailAccountResponse update(long userId, long id, EmailAccountRequest req) {
    String storedEnc =
        repo.findEncryptedPassword(userId, id)
            .orElseThrow(() -> new EmailAccountNotFoundException(id));
    if (repo.existsByUserAndAddressExcludingId(userId, req.emailAddress(), id)) {
      throw new DuplicateEmailAccountException(req.emailAddress());
    }
    String effectivePassword =
        isBlank(req.password()) ? encryption.decrypt(storedEnc) : req.password();

    ConnectionTestResult result = runTest(req, effectivePassword);
    if (!result.success()) {
      throw new MailConnectionException(result);
    }
    repo.update(userId, id, req, encryption.encrypt(effectivePassword));
    return repo.findByIdAndUser(userId, id).orElseThrow();
  }

  /** 계정 비활성화(soft delete). 본인 소유 아니면 404. */
  @Transactional
  public void delete(long userId, long id) {
    if (repo.softDelete(userId, id) == 0) {
      throw new EmailAccountNotFoundException(id);
    }
  }

  /** 공용: 주어진 비밀번호로 IMAP/SMTP 연결 검증. */
  private ConnectionTestResult runTest(EmailAccountRequest req, String password) {
    return tester.test(
        req.imapHost(),
        req.imapPort(),
        req.imapSecurity(),
        req.imapUsername(),
        req.smtpHost(),
        req.smtpPort(),
        req.smtpSecurity(),
        req.smtpUsername(),
        password);
  }

  private boolean isBlank(String s) {
    return s == null || s.isBlank();
  }
}
