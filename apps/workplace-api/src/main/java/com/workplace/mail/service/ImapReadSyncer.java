package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.repository.EmailAccountRepository;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * IMAP 계정 읽음 역동기화: 폴더에서 UID 로 메시지를 찾아 \Seen 플래그를 세운다.
 *
 * <p>실패는 예외로 전파하고 호출 측 리스너가 흡수한다. 자격증명은 로그에 포함하지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ImapReadSyncer implements MailReadSyncer {

  private final ImapConnector imapConnector;
  private final EmailAccountRepository accountRepo;
  private final EncryptionService encryption;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  /**
   * IMAP 서버에 접속해 해당 UID 메시지에 \Seen 플래그를 설정한다.
   *
   * <p>imapUid 가 null(로컬 생성 SENT 행)·비밀번호 없음·서버에서 사라진 메일은 다시 해도 안 되므로 건너뛰고 정상 반환한다. 접속·플래그 설정 실패는
   * 예외로 전파해(리스너가 로그를 남기고 흡수) 호출 측이 "서버 반영 대기" 표시를 유지하게 한다. 자격증명은 로그에 포함하지 않는다.
   */
  @Override
  public void markReadOnServer(long userId, EmailAccountResponse account, ReadSyncLocator loc)
      throws Exception {
    // 로컬 생성 행(SENT 등)은 서버 UID 없음 — 스킵
    if (loc.imapUid() == null) {
      return;
    }
    // 암호화된 비밀번호 조회 → 복호화
    String password =
        accountRepo
            .findEncryptedPassword(userId, loc.accountId())
            .map(encryption::decrypt)
            .orElse(null);
    if (password == null) {
      log.debug("IMAP 읽음 역동기화 스킵: 비밀번호 없음 accountId={}", loc.accountId());
      return;
    }
    String folderName = loc.folderName() != null ? loc.folderName() : "INBOX";
    Store store = imapConnector.connect(account, password);
    try {
      Folder folder = store.getFolder(folderName);
      folder.open(Folder.READ_WRITE);
      try {
        // UIDFolder 캐스팅: IMAPFolder 는 UIDFolder 를 구현한다.
        Message msg = ((UIDFolder) folder).getMessageByUID(loc.imapUid());
        if (msg != null) { // 서버에서 사라진 메일은 반영 불가 — 건너뜀
          msg.setFlag(Flags.Flag.SEEN, true);
        }
      } finally {
        folder.close(false);
      }
    } finally {
      store.close();
    }
  }
}
