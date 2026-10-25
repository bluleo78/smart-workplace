package com.workplace.mail.service.folder;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.service.ImapConnector;
import com.workplace.mail.service.MailAccountCredentials;
import jakarta.mail.Folder;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.eclipse.angus.mail.imap.protocol.Status;
import org.springframework.stereotype.Component;

/**
 * IMAP 서버 메일함 목록 조회(WP-960). {@code LIST "" "*"} 한 번으로 전체 폴더와 속성·구분자를 받고, 역할 판별은 {@link
 * ImapFolderClassifier} 에 맡긴 뒤 저장 대상 중 메일을 담는 폴더에만 STATUS(MESSAGES UNSEEN)를 보낸다 — 시스템 폴더에는 보내지 않는다.
 *
 * <p>비밀번호 조회만 짧은 읽기 트랜잭션({@link MailAccountCredentials})이고 IMAP 세션은 트랜잭션 밖에서 연다. 자격증명은 로그에 남기지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ImapFolderLister implements MailFolderLister {

  private final MailAccountCredentials credentials;
  private final ImapConnector imapConnector;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  /**
   * 서버 폴더 목록을 받아 저장 대상만 돌려준다. 연결·LIST 실패는 {@link MailSyncException} — 호출자는 아무것도 지우지 않는다. 폴더별 STATUS
   * 실패는 그 폴더 개수만 비워(null → 이전 값 유지) 목록 자체는 성공으로 둔다.
   */
  @Override
  public ServerFolderListing list(long userId, long accountId, EmailAccountResponse account) {
    String password = credentials.password(userId, accountId);
    Store store = null;
    try {
      store = imapConnector.connect(account, password);
      Folder[] all = store.getDefaultFolder().list("*");

      List<ImapFolderClassifier.Entry> entries = new ArrayList<>();
      Map<String, Folder> byName = new HashMap<>();
      String inboxRemoteId = null;
      for (Folder f : all) {
        String fullName = f.getFullName();
        byName.put(fullName, f);
        if ("INBOX".equalsIgnoreCase(fullName)) {
          inboxRemoteId = fullName;
        }
        entries.add(toEntry(f));
      }

      List<ServerFolder> kept = ImapFolderClassifier.classify(entries);
      List<ServerFolder> withCounts = new ArrayList<>(kept.size());
      for (ServerFolder sf : kept) {
        // 묶음 노드(\Noselect)는 STATUS 를 받을 수 없다 — 개수 없이 둔다.
        withCounts.add(sf.selectable() ? withStatus(sf, byName.get(sf.key())) : sf);
      }
      return new ServerFolderListing(withCounts, inboxRemoteId);
    } catch (MessagingException e) {
      throw new MailSyncException("메일함 목록을 가져오지 못했습니다", e);
    } finally {
      if (store != null) {
        try {
          store.close();
        } catch (MessagingException ignored) {
          // 목록 결과에 영향 없음
        }
      }
    }
  }

  /** LIST 응답 한 항목을 판별기 입력으로 바꾼다. 속성·구분자·종류는 LIST 응답에 이미 담겨 있어 추가 왕복이 없다. */
  private static ImapFolderClassifier.Entry toEntry(Folder f) throws MessagingException {
    List<String> attrs =
        f instanceof IMAPFolder imap && imap.getAttributes() != null
            ? Arrays.asList(imap.getAttributes())
            : List.of();
    boolean noSelect =
        attrs.stream()
            .map(a -> a.toLowerCase(Locale.ROOT))
            .anyMatch(a -> a.equals("\\noselect") || a.equals("\\nonexistent"));
    boolean holdsMessages = !noSelect && (f.getType() & Folder.HOLDS_MESSAGES) != 0;
    return new ImapFolderClassifier.Entry(f.getFullName(), f.getSeparator(), attrs, holdsMessages);
  }

  /**
   * STATUS (MESSAGES UNSEEN) 한 번으로 전체·안 읽은 수를 받는다(getMessageCount/getUnreadMessageCount 는 각각 STATUS
   * 를 보내 왕복이 두 배). 실패는 경고 로그 후 개수 없이 돌려준다 — 폴더가 사라진 것으로 보면 안 된다.
   */
  private static ServerFolder withStatus(ServerFolder sf, Folder folder) {
    if (!(folder instanceof IMAPFolder imap)) {
      return sf;
    }
    try {
      Status st =
          (Status)
              imap.doCommand(
                  p -> p.status(imap.getFullName(), new String[] {"MESSAGES", "UNSEEN"}));
      Integer total = st != null && st.total >= 0 ? st.total : null;
      Integer unread = st != null && st.unseen >= 0 ? st.unseen : null;
      return sf.withCounts(unread, total);
    } catch (Exception e) {
      log.warn("IMAP 메일함 STATUS 실패(개수만 건너뜀): {}", e.toString());
      return sf;
    }
  }
}
