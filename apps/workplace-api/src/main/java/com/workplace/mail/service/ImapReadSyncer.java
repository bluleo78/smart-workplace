package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.repository.EmailAccountRepository;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.springframework.stereotype.Component;

/**
 * IMAP 계정 읽음 역동기화(WP-187): 폴더별 UID 묶음을 찾아 \Seen 을 켜고 끈다.
 *
 * <p>WP-215: 비밀번호는 {@link #open} 에서 한 번 조회·복호화하고, 서버 접속·로그인은 첫 push 에서 한 번 해 디스패치가 끝날 때까지 조각끼리
 * 재사용한다. 실패는 예외로 전파하고 호출 측(디스패처)이 그 묶음의 대기 표시를 유지한다. 자격증명은 로그에 포함하지 않는다.
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
   * 암호화된 비밀번호를 조회·복호화해 세션을 연다. 접속은 하지 않는다.
   *
   * <p>비밀번호 조회는 RLS 스코프라 호출 측 트랜잭션(테넌트 GUC) 안에서 불려야 한다 — 밖이면 0행 → "비밀번호 없음"으로 조용히 빠진다(#444). 비밀번호가
   * 없으면 다시 해도 반영할 수 없으므로 모든 항목을 끝난 것으로 보는 세션을 돌려준다.
   */
  @Override
  public Session open(long userId, EmailAccountResponse account) {
    String password =
        accountRepo
            .findEncryptedPassword(userId, account.id())
            .map(encryption::decrypt)
            .orElse(null);
    if (password == null) {
      log.debug("IMAP 읽음 역동기화 스킵: 비밀번호 없음 accountId={}", account.id());
      return SeenSyncResult::all;
    }
    return new ImapSession(account, password);
  }

  /** 접속 1회를 조각끼리 재사용하는 세션. 디스패처가 한 스레드에서 순서대로 부르므로 동기화는 필요 없다. */
  private final class ImapSession implements Session {

    private final EmailAccountResponse account;
    private final String password;
    private Store store;

    ImapSession(EmailAccountResponse account, String password) {
      this.account = account;
      this.password = password;
    }

    /**
     * 폴더별로 열어 seen=true 묶음은 \Seen 켜기, false 묶음은 끄기. UID 없는 로컬 행(SENT 등)·서버에서 사라진 메일은 다시 해도 안 되므로 끝난
     * 것으로 본다. 접속·플래그 실패는 예외로 전파한다(호출 측이 이 묶음 전체의 대기 표시를 유지).
     */
    @Override
    public SeenSyncResult push(List<SeenSyncItem> items) throws MessagingException {
      List<SeenSyncItem> remote =
          items.stream().filter(it -> it.locator().imapUid() != null).toList();
      if (remote.isEmpty()) {
        return SeenSyncResult.all(items);
      }
      // 폴더별로 묶는다(폴더 이름 없으면 INBOX) — 폴더마다 한 번 열어 처리한다
      Map<String, List<SeenSyncItem>> byFolder =
          remote.stream()
              .collect(
                  Collectors.groupingBy(
                      it -> it.locator().folderName() != null ? it.locator().folderName() : "INBOX",
                      LinkedHashMap::new,
                      Collectors.toList()));
      if (store == null) {
        store = imapConnector.connect(account, password);
      }
      for (Map.Entry<String, List<SeenSyncItem>> e : byFolder.entrySet()) {
        // IMAP 스토어의 폴더는 IMAPFolder — UID 조회(UIDFolder)와 플래그 설정(Folder)을 한 객체로 쓴다
        IMAPFolder folder = (IMAPFolder) store.getFolder(e.getKey());
        folder.open(Folder.READ_WRITE);
        try {
          applySeen(folder, e.getValue(), true);
          applySeen(folder, e.getValue(), false);
        } finally {
          folder.close(false);
        }
      }
      return SeenSyncResult.all(items);
    }

    /** 접속했다면 닫는다. 닫기 실패는 반영 결과와 무관하므로 로그만 남긴다. */
    @Override
    public void close() {
      if (store == null) {
        return;
      }
      try {
        store.close();
      } catch (MessagingException e) {
        log.debug("IMAP 읽음 역동기화 접속 닫기 실패: accountId={}", account.id());
      }
    }
  }

  /** seen 값이 같은 항목들의 UID 를 한 번에 조회해 \Seen 을 맞춘다. 서버에서 사라진 메일(null)은 건너뛴다. */
  private static void applySeen(IMAPFolder folder, List<SeenSyncItem> items, boolean seen)
      throws MessagingException {
    long[] uids =
        items.stream()
            .filter(it -> it.seen() == seen)
            .mapToLong(it -> it.locator().imapUid())
            .toArray();
    if (uids.length == 0) {
      return;
    }
    Message[] msgs =
        Arrays.stream(folder.getMessagesByUID(uids))
            .filter(Objects::nonNull)
            .toArray(Message[]::new);
    if (msgs.length > 0) {
      folder.setFlags(msgs, new Flags(Flags.Flag.SEEN), seen);
    }
  }
}
