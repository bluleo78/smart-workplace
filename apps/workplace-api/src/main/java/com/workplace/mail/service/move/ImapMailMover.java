package com.workplace.mail.service.move;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.exception.MailValidationException;
import com.workplace.mail.service.ImapConnector;
import com.workplace.mail.service.MailAccountCredentials;
import com.workplace.mail.service.folder.ImapFolderClassifier;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.angus.mail.imap.AppendUID;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.eclipse.angus.mail.imap.IMAPStore;
import org.springframework.stereotype.Component;

/**
 * IMAP 메일 옮기기(WP-962). 원래 메일함별로 한 번씩 READ_WRITE 로 열어 옮긴다.
 *
 * <ul>
 *   <li>서버가 MOVE(RFC 6851)를 지원하면 MOVE — UIDPLUS 도 있으면 COPYUID 로 옮긴 곳의 새 UID 를 받는다.
 *   <li>MOVE 가 없으면 COPY + {@code \Deleted} + 그 메일만 {@code UID EXPUNGE}(UIDPLUS 필요). 일반 EXPUNGE 는
 *       메일함의 다른 {@code \Deleted} 메일까지 지우므로 쓰지 않는다 — MOVE·UIDPLUS 가 둘 다 없는 서버는 옮기지 않고 실패로 알린다.
 * </ul>
 *
 * <p>휴지통은 LIST 의 SPECIAL-USE {@code \Trash} 또는 이름으로 찾는다({@link ImapFolderClassifier#findTrash}).
 * 비밀번호 조회만 짧은 읽기 트랜잭션이고 IMAP 세션은 트랜잭션 밖이다. 자격증명은 로그에 남기지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ImapMailMover implements MailMover {

  private static final String NOT_FOUND = "메일 서버에서 메일을 찾을 수 없습니다";
  private static final String MOVE_FAILED = "메일 서버에서 옮기지 못했습니다";

  private final MailAccountCredentials credentials;
  private final ImapConnector imapConnector;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  @Override
  public List<Outcome> move(
      long userId, EmailAccountResponse account, List<Item> items, Destination dest) {
    String password = credentials.password(userId, account.id());
    List<Outcome> out = new ArrayList<>();
    Store store = null;
    try {
      store = imapConnector.connect(account, password);
      String destName =
          dest.kind() == MailMoveRequest.Kind.TRASH ? findTrash(store) : dest.imapName();
      if (destName == null) {
        throw new MailValidationException("메일 서버에서 휴지통을 찾을 수 없습니다");
      }
      Capabilities caps = capabilities((IMAPStore) store);
      if (!caps.move() && !caps.uidPlus()) {
        // 일반 EXPUNGE 로 다른 메일까지 지울 수 없어 옮기지 않는다(클래스 주석).
        items.forEach(it -> out.add(Outcome.failed(it.messageId(), "메일 서버가 메일 옮기기를 지원하지 않습니다")));
        return out;
      }
      Folder destFolder = store.getFolder(destName);
      Map<String, List<Item>> bySource =
          items.stream()
              .collect(
                  Collectors.groupingBy(
                      Item::sourceFolderName, LinkedHashMap::new, Collectors.toList()));
      for (Map.Entry<String, List<Item>> e : bySource.entrySet()) {
        out.addAll(moveFromFolder(store, e.getKey(), e.getValue(), destFolder, caps));
      }
      return out;
    } catch (MessagingException e) {
      throw new MailSyncException("메일 서버에 연결하지 못했습니다", e);
    } finally {
      if (store != null) {
        try {
          store.close();
        } catch (MessagingException ignored) {
          // 옮기기 결과에 영향 없음
        }
      }
    }
  }

  /** 서버 확장 지원 여부. */
  public record Capabilities(boolean move, boolean uidPlus) {}

  /** 서버가 MOVE·UIDPLUS 를 지원하는지. 테스트가 COPY 대체 경로를 강제하려고 덮어쓴다. */
  protected Capabilities capabilities(IMAPStore store) throws MessagingException {
    return new Capabilities(store.hasCapability("MOVE"), store.hasCapability("UIDPLUS"));
  }

  /** LIST 로 서버 휴지통 전체 경로를 찾는다. 없으면 null. */
  private static String findTrash(Store store) throws MessagingException {
    List<ImapFolderClassifier.Entry> entries = new ArrayList<>();
    for (Folder f : store.getDefaultFolder().list("*")) {
      List<String> attrs =
          f instanceof IMAPFolder imap && imap.getAttributes() != null
              ? Arrays.asList(imap.getAttributes())
              : List.of();
      boolean noSelect =
          attrs.stream()
              .map(a -> a.toLowerCase(Locale.ROOT))
              .anyMatch(a -> a.equals("\\noselect") || a.equals("\\nonexistent"));
      boolean holds = !noSelect && (f.getType() & Folder.HOLDS_MESSAGES) != 0;
      entries.add(new ImapFolderClassifier.Entry(f.getFullName(), f.getSeparator(), attrs, holds));
    }
    return ImapFolderClassifier.findTrash(entries);
  }

  /**
   * 원래 메일함 하나의 메일들을 옮긴다. 서버에 없는 UID 는 그 메일만 실패, 메일함 단위 명령(열기·플래그·MOVE)이 실패하면 이 메일함의 메일 전체가 실패다(다른
   * 메일함 묶음은 계속).
   */
  private List<Outcome> moveFromFolder(
      Store store, String sourceName, List<Item> items, Folder destFolder, Capabilities caps) {
    List<Outcome> out = new ArrayList<>();
    List<Item> withUid = new ArrayList<>();
    for (Item it : items) {
      if (it.imapUid() == null) {
        out.add(Outcome.failed(it.messageId(), NOT_FOUND)); // 서버 위치를 모르는 로컬 행
      } else {
        withUid.add(it);
      }
    }
    if (withUid.isEmpty()) {
      return out;
    }
    IMAPFolder source = null;
    try {
      source = (IMAPFolder) store.getFolder(sourceName);
      source.open(Folder.READ_WRITE);
      // 로컬에 기록된 UIDVALIDITY 가 없거나 서버와 다르면 저장된 UID 가 다른 메일을 가리킬 수 있다 — 이 메일함 메일은 옮기지 않는다
      // (다음 동기화가 UIDVALIDITY 변경을 감지해 로컬을 다시 받는다).
      Long localValidity = withUid.get(0).sourceUidValidity();
      if (localValidity == null || localValidity != source.getUIDValidity()) {
        log.warn("IMAP 메일 옮기기 건너뜀 — UIDVALIDITY 불일치: folder={}", sourceName);
        withUid.forEach(
            it -> out.add(Outcome.failed(it.messageId(), "메일함이 바뀌었습니다 — 동기화 후 다시 시도해 주세요")));
        return out;
      }
      long[] uids = withUid.stream().mapToLong(Item::imapUid).toArray();
      Message[] found = source.getMessagesByUID(uids);
      List<Item> present = new ArrayList<>();
      List<Message> msgs = new ArrayList<>();
      for (int i = 0; i < uids.length; i++) {
        if (found[i] == null) {
          out.add(Outcome.failed(withUid.get(i).messageId(), NOT_FOUND));
        } else {
          present.add(withUid.get(i));
          msgs.add(found[i]);
        }
      }
      if (present.isEmpty()) {
        return out;
      }
      // 반영 대기 읽음을 먼저 서버에 — 플래그는 MOVE·COPY 로 함께 옮겨지므로 옮긴 뒤 로컬 대기를 풀 수 있다.
      pushPendingSeen(source, present, msgs, true);
      pushPendingSeen(source, present, msgs, false);

      Message[] arr = msgs.toArray(Message[]::new);
      AppendUID[] uidsAfter;
      if (caps.move()) {
        if (caps.uidPlus()) {
          uidsAfter = source.moveUIDMessages(arr, destFolder);
        } else {
          source.moveMessages(arr, destFolder);
          uidsAfter = null; // 새 UID 를 알 수 없다 — 다음 동기화가 넣는다
        }
      } else {
        // COPY + \Deleted + 그 메일만 UID EXPUNGE(UIDPLUS 확인됨)
        uidsAfter = source.copyUIDMessages(arr, destFolder);
        source.setFlags(arr, new Flags(Flags.Flag.DELETED), true);
        source.expunge(arr);
      }
      for (int i = 0; i < present.size(); i++) {
        Item it = present.get(i);
        AppendUID au = uidsAfter != null && i < uidsAfter.length ? uidsAfter[i] : null;
        out.add(
            new Outcome(
                it.messageId(),
                true,
                au == null ? null : au.uid,
                au == null ? null : au.uidvalidity,
                null,
                it.seenPushPending(),
                null,
                null));
      }
      return out;
    } catch (MessagingException | RuntimeException e) {
      log.warn("IMAP 메일 옮기기 실패: accountFolder={} {}", sourceName, e.toString());
      List<Long> done = out.stream().map(Outcome::messageId).toList();
      for (Item it : items) {
        if (!done.contains(it.messageId())) {
          out.add(Outcome.failed(it.messageId(), MOVE_FAILED));
        }
      }
      return out;
    } finally {
      if (source != null && source.isOpen()) {
        try {
          source.close(false);
        } catch (MessagingException ignored) {
          // 결과에 영향 없음
        }
      }
    }
  }

  /** 반영 대기 중이고 로컬 읽음이 seen 인 메일의 {@code \Seen} 을 서버에 맞춘다. */
  private static void pushPendingSeen(
      IMAPFolder folder, List<Item> items, List<Message> msgs, boolean seen)
      throws MessagingException {
    List<Message> target = new ArrayList<>();
    for (int i = 0; i < items.size(); i++) {
      if (items.get(i).seenPushPending() && items.get(i).seen() == seen) {
        target.add(msgs.get(i));
      }
    }
    if (!target.isEmpty()) {
      folder.setFlags(target.toArray(Message[]::new), new Flags(Flags.Flag.SEEN), seen);
    }
  }
}
