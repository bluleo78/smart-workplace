package com.workplace.mail.service;

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
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.springframework.stereotype.Component;

/**
 * IMAP 계정 읽음·별표 역동기화(WP-187, WP-1741 별표): 폴더별 UID 묶음을 찾아 \Seen·\Flagged 를 켜고 끈다(STORE 는 플래그마다 따로).
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
  private final MailAccountCredentials credentials;

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
            .map(enc -> credentials.decrypt(account.id(), enc))
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
      Set<Long> localOnly = new HashSet<>();
      for (Map.Entry<String, List<SeenSyncItem>> e : byFolder.entrySet()) {
        // IMAP 스토어의 폴더는 IMAPFolder — UID 조회(UIDFolder)와 플래그 설정(Folder)을 한 객체로 쓴다
        IMAPFolder folder = (IMAPFolder) store.getFolder(e.getKey());
        folder.open(Folder.READ_WRITE);
        try {
          List<SeenSyncItem> folderItems = e.getValue();
          // WP-1741: 별표는 서버가 \Flagged 를 영구 저장할 수 있을 때만 보낸다. 못 하면 앱 안에만 둔다 — 다시 해도 안 되므로 끝난 것으로
          // 돌려주되 「앱 안에만」으로 표시해, 디스패처가 대기를 보류(재시도 없음·동기화가 덮지 않음)하게 한다.
          boolean flaggedSupported = supportsFlagged(folder.getPermanentFlags());
          if (!flaggedSupported) {
            folderItems.stream()
                .filter(it -> it.flagged() != null)
                .forEach(it -> localOnly.add(it.messageId()));
            log.debug("IMAP 별표 역동기화 생략: 메일함이 \\Flagged 를 지원하지 않음 accountId={}", account.id());
          }
          // 보낼 속성이 있는 항목의 메시지를 UID FETCH 한 번으로 찾아 두고, 플래그별 STORE 는 이 맵에서 고른다
          Map<Long, Message> messages =
              messagesByUid(
                  folder,
                  folderItems.stream()
                      .filter(it -> it.seen() != null || (flaggedSupported && it.flagged() != null))
                      .toList());
          applyFlag(folder, messages, folderItems, SeenSyncItem::seen, Flags.Flag.SEEN);
          if (flaggedSupported) {
            applyFlag(folder, messages, folderItems, SeenSyncItem::flagged, Flags.Flag.FLAGGED);
          }
        } finally {
          folder.close(false);
        }
      }
      return SeenSyncResult.all(items, localOnly);
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

  /**
   * 항목들의 UID 를 한 번에 조회해(UID FETCH 1회) UID → 메시지 맵을 만든다. 서버에서 사라진 메일(null)은 맵에 넣지 않는다. 대상이 없으면 조회하지
   * 않는다. getMessagesByUID 는 요청 UID 와 같은 순서·길이의 배열을 돌려주므로 위치로 짝짓는다.
   */
  private static Map<Long, Message> messagesByUid(IMAPFolder folder, List<SeenSyncItem> items)
      throws MessagingException {
    long[] uids = items.stream().mapToLong(it -> it.locator().imapUid()).toArray();
    if (uids.length == 0) {
      return Map.of();
    }
    Message[] found = folder.getMessagesByUID(uids);
    Map<Long, Message> byUid = new HashMap<>();
    for (int i = 0; i < uids.length; i++) {
      if (found[i] != null) {
        byUid.put(uids[i], found[i]);
      }
    }
    return byUid;
  }

  /**
   * 시스템 플래그 하나를 서버에 맞춘다(WP-187 \Seen, WP-1741 \Flagged) — 속성 값이 TRUE 인 항목은 켜고(STORE +FLAGS) FALSE 인
   * 항목은 끈다(STORE -FLAGS). 반영 대상이 아닌 항목(null)과 서버에서 사라진 메일은 빠진다. 켜기·끄기마다 STORE 한 번.
   *
   * @param messages {@link #messagesByUid} 로 미리 찾은 UID → 메시지
   * @param attr 항목에서 이 플래그로 보낼 값을 꺼내는 함수(null = 건드리지 않음)
   */
  private static void applyFlag(
      IMAPFolder folder,
      Map<Long, Message> messages,
      List<SeenSyncItem> items,
      Function<SeenSyncItem, Boolean> attr,
      Flags.Flag flag)
      throws MessagingException {
    for (boolean set : new boolean[] {true, false}) {
      Message[] msgs =
          items.stream()
              .filter(it -> Boolean.valueOf(set).equals(attr.apply(it)))
              .map(it -> messages.get(it.locator().imapUid()))
              .filter(Objects::nonNull)
              .toArray(Message[]::new);
      if (msgs.length > 0) {
        folder.setFlags(msgs, new Flags(flag), set);
      }
    }
  }

  /**
   * 열린 메일함이 \Flagged 를 영구 저장할 수 있는지(WP-1741). PERMANENTFLAGS 에 \Flagged 또는 {@code \*}(임의 플래그 —
   * Jakarta Mail 은 {@link Flags.Flag#USER} 로 나타낸다)가 있으면 된다. 서버가 목록을 주지 않으면(null) RFC 3501 상 모든 플래그가
   * 영구이므로 지원으로 본다.
   */
  public static boolean supportsFlagged(Flags permanentFlags) {
    return permanentFlags == null
        || permanentFlags.contains(Flags.Flag.FLAGGED)
        || permanentFlags.contains(Flags.Flag.USER);
  }
}
