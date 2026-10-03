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
import jakarta.mail.UIDFolder;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * IMAP 계정 읽음 역동기화(WP-187): 접속 1회로 폴더별 UID 묶음을 찾아 \Seen 을 켜고 끈다.
 *
 * <p>실패는 예외로 전파하고 호출 측(디스패처)이 그 묶음의 대기 표시를 유지한다. 자격증명은 로그에 포함하지 않는다.
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
   * 접속 1회, 폴더별로 열어 seen=true 묶음은 \Seen 켜기, false 묶음은 끄기. UID 없는 로컬 행(SENT 등)·비밀번호 없음·서버에서 사라진 메일은
   * 다시 해도 안 되므로 끝난 것으로 본다. 접속·플래그 실패는 예외로 전파한다(호출 측이 이 묶음 전체의 대기 표시를 유지).
   *
   * <p>비밀번호 조회는 RLS 스코프라 호출 측 트랜잭션(테넌트 GUC) 안에서 불려야 한다 — 밖이면 0행 → "비밀번호 없음"으로 조용히 빠진다(#444).
   */
  @Override
  public SeenSyncResult syncSeen(
      long userId, EmailAccountResponse account, List<SeenSyncItem> items) throws Exception {
    List<SeenSyncItem> remote =
        items.stream().filter(it -> it.locator().imapUid() != null).toList();
    if (remote.isEmpty()) {
      return SeenSyncResult.all(items);
    }
    long accountId = remote.get(0).locator().accountId();
    // 암호화된 비밀번호 조회 → 복호화
    String password =
        accountRepo.findEncryptedPassword(userId, accountId).map(encryption::decrypt).orElse(null);
    if (password == null) {
      log.debug("IMAP 읽음 역동기화 스킵: 비밀번호 없음 accountId={}", accountId);
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
    Store store = imapConnector.connect(account, password);
    try {
      for (Map.Entry<String, List<SeenSyncItem>> e : byFolder.entrySet()) {
        Folder folder = store.getFolder(e.getKey());
        folder.open(Folder.READ_WRITE);
        try {
          // UIDFolder 캐스팅: IMAPFolder 는 UIDFolder 를 구현한다
          applySeen((UIDFolder) folder, folder, e.getValue(), true);
          applySeen((UIDFolder) folder, folder, e.getValue(), false);
        } finally {
          folder.close(false);
        }
      }
    } finally {
      store.close();
    }
    return SeenSyncResult.all(items);
  }

  /** seen 값이 같은 항목들의 UID 를 한 번에 조회해 \Seen 을 맞춘다. 서버에서 사라진 메일(null)은 건너뛴다. */
  private static void applySeen(
      UIDFolder uidFolder, Folder folder, List<SeenSyncItem> items, boolean seen)
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
        Arrays.stream(uidFolder.getMessagesByUID(uids))
            .filter(Objects::nonNull)
            .toArray(Message[]::new);
    if (msgs.length > 0) {
      folder.setFlags(msgs, new Flags(Flags.Flag.SEEN), seen);
    }
  }
}
