package com.workplace.mail.service.trash;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.exception.MailTrashException;
import com.workplace.mail.service.ImapConnector;
import com.workplace.mail.service.MailAccountCredentials;
import com.workplace.mail.service.MailServerErrors;
import com.workplace.mail.service.folder.ImapFolderEntries;
import jakarta.mail.FetchProfile;
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.FolderClosedException;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import jakarta.mail.StoreClosedException;
import jakarta.mail.UIDFolder;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.eclipse.angus.mail.imap.IMAPFolder;
import org.eclipse.angus.mail.imap.IMAPStore;
import org.springframework.stereotype.Component;

/**
 * IMAP 휴지통 메일 완전히 삭제(WP-1682). 지울 메일에만 {@code \Deleted} 를 붙이고 그 메일만 {@code UID EXPUNGE}(UIDPLUS,
 * {@code IMAPFolder.expunge(Message[])})한 뒤 {@code close(false)} 로 닫는다. 일반 EXPUNGE(인자 없는
 * expunge·{@code close(true)})는 같은 휴지통에 다른 클라이언트가 지울 표시만 해 둔 메일까지 지우므로 쓰지 않는다 — 그래서 UIDPLUS 가 없는
 * 서버는 아무 플래그도 건드리지 않고 거절한다.
 *
 * <p>휴지통은 지금 LIST 로 찾은 휴지통({@link ImapFolderEntries#findTrash})이 휴지통 행 이름과 같을 때만, UID 는 휴지통 행의
 * UIDVALIDITY 가 서버와 같을 때만 믿는다 — 아니면 다른 메일함·다른 메일을 지울 수 있어 지우지 않는다. 비밀번호 조회만 짧은 읽기 트랜잭션이고 IMAP 세션은
 * 트랜잭션 밖이다. 로그에는 계정 id·개수만 남긴다(제목·주소·자격증명 없음).
 *
 * <p>휴지통 비우기({@link #emptyTrash})도 같은 접속·확인 단계를 거친 뒤 휴지통 전체를 묶음씩 같은 방식({@code \Deleted} + 그 묶음만
 * {@code UID EXPUNGE})으로 지운다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ImapMailEraser implements MailEraser {

  /** 비우기 한 묶음의 UID 수 — UID EXPUNGE 명령 한 줄이 너무 길어지지 않게 나눈다. */
  public static final int IMAP_CHUNK = 500;

  private final MailAccountCredentials credentials;
  private final ImapConnector imapConnector;

  /** 비우기 묶음 크기 — 운영은 {@link #IMAP_CHUNK} 고정. 테스트가 작은 값으로 바꿔 여러 묶음 진행을 본다. */
  private int imapChunk = IMAP_CHUNK;

  @Override
  public MailProvider provider() {
    return MailProvider.IMAP;
  }

  @Override
  public List<Outcome> erase(
      long userId, EmailAccountResponse account, TrashRef trash, List<Item> items) {
    String password = credentials.password(userId, account.id());
    Store store = null;
    try {
      store = connectWithUidPlus(account, password);
      if (!trashUnchanged(store, trash, account.id())) {
        return failedAll(items, MailTrashException.messageOf(MailTrashException.TRASH_CHANGED));
      }
      return eraseInTrash(account.id(), store, trash, items);
    } catch (MessagingException e) {
      throw new MailSyncException(MailServerErrors.CONNECT_FAILED, e);
    } finally {
      closeQuietly(store);
    }
  }

  /**
   * 휴지통 비우기 — 서버 휴지통 바로 아래의 모든 메일을 {@link #imapChunk} 개씩 지운다(WP-1682). 순서: 접속·UIDPLUS 확인 → 지금 휴지통이
   * 휴지통 행과 같은지(아니면 {@code TRASH_CHANGED}, 아무것도 지우지 않음) → 휴지통 READ_WRITE 열기, 서버 UIDVALIDITY 기억 → UID
   * 스냅샷(시작 순간의 전체 — 비우는 사이 새로 들어온 메일은 건드리지 않는다) → 묶음마다 서버에 남은 것만 {@code \Deleted} + {@code UID
   * EXPUNGE} 하고 sink 로 넘긴다.
   *
   * <p>묶음 명령이 실패하면 그 묶음만 실패로 세고 다음 묶음으로 간다. 연결이 끊기면 작업 전체에서 한 번만 다시 접속해 같은 묶음부터 잇는다 — 다시 열었을 때
   * UIDVALIDITY 가 바뀌었으면 스냅샷 UID 가 다른 메일을 가리킬 수 있어 {@code TRASH_CHANGED}, 다시 접속도 실패하거나 또 끊기면 {@code
   * SERVER_UNREACHABLE}. 묶음 사이에 스레드 인터럽트(앱 종료)를 보면 {@code INTERRUPTED} 로 멈춘다 — 이미 넘긴 묶음은 로컬도 반영돼 있어
   * 일관적이다. 닫기는 언제나 {@code close(false)}(expunge 없음).
   */
  @Override
  public void emptyTrash(
      long userId, EmailAccountResponse account, TrashRef trash, EmptySink sink) {
    String password = emptyPassword(userId, account.id());
    OpenTrash open = openForEmpty(account, password, trash);
    try {
      long validity = open.uidValidity();
      List<Long> uids = snapshotUids(account.id(), open.folder());
      sink.snapshot(uids.size());
      boolean reconnected = false;
      for (int from = 0; from < uids.size(); from += imapChunk) {
        if (Thread.currentThread().isInterrupted()) {
          // 앱 종료(shutdownNow) — 남은 묶음은 서버·앱 모두 휴지통에 남고 다시 비우면 된다
          throw MailTrashException.of(MailTrashException.INTERRUPTED);
        }
        List<Long> chunk = List.copyOf(uids.subList(from, Math.min(from + imapChunk, uids.size())));
        ChunkResult result = eraseChunk(account.id(), open.folder(), chunk);
        if (result == ChunkResult.DISCONNECTED) {
          if (reconnected) {
            throw MailTrashException.of(MailTrashException.SERVER_UNREACHABLE);
          }
          reconnected = true;
          open.close();
          open = reopen(account, password, trash, validity);
          result = eraseChunk(account.id(), open.folder(), chunk);
          if (result == ChunkResult.DISCONNECTED) {
            throw MailTrashException.of(MailTrashException.SERVER_UNREACHABLE);
          }
        }
        // sink 호출은 명령 try 밖 — 로컬 반영 실패(계정 해제 등)는 묶음 실패가 아니라 작업을 멈춘다
        if (result == ChunkResult.ERASED) {
          sink.erasedImap(validity, chunk);
        } else {
          sink.failed(chunk.size());
        }
      }
    } finally {
      open.close();
    }
  }

  /**
   * 비우기용 비밀번호 — 시작 확인 뒤 실행 전에 계정 연결이 해제됐으면(비밀번호 조회에 계정이 없다) 서버 연결 실패가 아니라 {@code ACCOUNT_GONE} 으로
   * 멈춘다(Graph 의 토큰 조회와 같다 — 작업은 갱신할 계정이 없어 목록 갱신도 건너뛴다).
   */
  private String emptyPassword(long userId, long accountId) {
    try {
      return credentials.password(userId, accountId);
    } catch (EmailAccountNotFoundException e) {
      throw MailTrashException.of(MailTrashException.ACCOUNT_GONE);
    }
  }

  /** 비우기용으로 연 휴지통 — 닫을 때 메일함은 expunge 없이, 저장소는 그다음에 닫는다. */
  private record OpenTrash(Store store, IMAPFolder folder, long uidValidity) {

    void close() {
      closeQuietly(folder);
      closeQuietly(store);
    }
  }

  /** 한 묶음 결과 — 지웠음(이미 없던 것 포함)·명령 실패·연결 끊김. */
  private enum ChunkResult {
    ERASED,
    FAILED,
    DISCONNECTED
  }

  /**
   * 비우기의 접속 단계 — {@link #erase} 와 같은 순서(접속·UIDPLUS → 휴지통 이름 확인 → READ_WRITE 열기)에 서버 UIDVALIDITY 를
   * 더해 돌려준다. 휴지통이 바뀌었으면 {@code TRASH_CHANGED}, 접속·LIST·열기 실패는 {@code SERVER_UNREACHABLE}. 던질 때는 연
   * 것을 닫는다.
   */
  private OpenTrash openForEmpty(EmailAccountResponse account, String password, TrashRef trash) {
    Store store = null;
    try {
      store = connectWithUidPlus(account, password);
      if (!trashUnchanged(store, trash, account.id())) {
        throw MailTrashException.of(MailTrashException.TRASH_CHANGED);
      }
      IMAPFolder folder = openTrash(store, trash.name());
      return new OpenTrash(store, folder, folder.getUIDValidity());
    } catch (MessagingException e) {
      log.warn("IMAP 휴지통 비우기 접속 실패: accountId={} {}", account.id(), e.getClass().getSimpleName());
      closeQuietly(store);
      throw MailTrashException.of(MailTrashException.SERVER_UNREACHABLE);
    } catch (RuntimeException e) {
      closeQuietly(store);
      throw e;
    }
  }

  /** 끊긴 뒤 한 번 다시 접속한다. 휴지통 UIDVALIDITY 가 처음과 다르면 스냅샷 UID 를 믿을 수 없어 {@code TRASH_CHANGED}. */
  private OpenTrash reopen(
      EmailAccountResponse account, String password, TrashRef trash, long validity) {
    log.warn("IMAP 휴지통 비우기 연결 끊김 — 다시 접속: accountId={}", account.id());
    OpenTrash open = openForEmpty(account, password, trash);
    if (open.uidValidity() != validity) {
      open.close();
      log.warn("IMAP 휴지통 비우기 멈춤 — 다시 접속하니 UIDVALIDITY 가 바뀜: accountId={}", account.id());
      throw MailTrashException.of(MailTrashException.TRASH_CHANGED);
    }
    return open;
  }

  /**
   * 시작 순간 휴지통의 모든 UID({@code UID FETCH 1:*}). 빈 메일함은 명령을 보내지 않는다. 실패는 아무것도 지우기 전이라 {@code
   * SERVER_UNREACHABLE}.
   */
  private static List<Long> snapshotUids(long accountId, IMAPFolder folder) {
    try {
      if (folder.getMessageCount() == 0) {
        return List.of();
      }
      Message[] all = folder.getMessagesByUID(1, UIDFolder.LASTUID);
      FetchProfile fp = new FetchProfile();
      fp.add(UIDFolder.FetchProfileItem.UID);
      folder.fetch(all, fp);
      List<Long> uids = new ArrayList<>(all.length);
      for (Message m : all) {
        uids.add(folder.getUID(m));
      }
      return uids;
    } catch (MessagingException e) {
      log.warn("IMAP 휴지통 UID 목록 실패: accountId={} {}", accountId, e.getClass().getSimpleName());
      throw MailTrashException.of(MailTrashException.SERVER_UNREACHABLE);
    }
  }

  /**
   * 한 묶음을 지운다 — 서버에 남은 UID 만 골라 {@link #eraseMessages}(이미 없는 UID 는 목표 상태라 성공). 연결이 끊긴 예외({@code
   * FolderClosedException}·{@code StoreClosedException})와 그 밖 명령 실패를 나눠 돌려준다 — 끊김만 다시 접속할 가치가 있다.
   */
  private ChunkResult eraseChunk(long accountId, IMAPFolder folder, List<Long> uids) {
    try {
      Message[] found = folder.getMessagesByUID(uids.stream().mapToLong(Long::longValue).toArray());
      List<Message> present = new ArrayList<>();
      for (Message m : found) {
        if (m != null) {
          present.add(m);
        }
      }
      eraseMessages(accountId, folder, present);
      return ChunkResult.ERASED;
    } catch (FolderClosedException | StoreClosedException e) {
      return ChunkResult.DISCONNECTED;
    } catch (MessagingException e) {
      log.warn(
          "IMAP 휴지통 비우기 묶음 실패: accountId={} count={} {}",
          accountId,
          uids.size(),
          e.getClass().getSimpleName());
      return ChunkResult.FAILED;
    }
  }

  /** 서버가 UIDPLUS 를 지원하는지. 테스트가 지원하지 않는 서버를 흉내 내려고 덮어쓴다. */
  protected boolean uidPlus(IMAPStore store) throws MessagingException {
    return store.hasCapability("UIDPLUS");
  }

  /**
   * 접속하고 UIDPLUS 를 확인한다(완전 삭제·비우기 공용 첫 단계). UIDPLUS 가 없으면 아무것도 건드리지 않고 {@code
   * PERMANENT_DELETE_UNSUPPORTED} 로 거절한다 — 그 메일만 지울 방법(UID EXPUNGE)이 없고 일반 EXPUNGE 는 남의 지운 표시 메일까지
   * 지운다. 계정에 기록하는 일은 호출자({@link MailTrashService}·{@link MailTrashEmptyJob})가 트랜잭션에서 한다. 확인에서 던지면
   * 연결을 닫는다(호출자는 아직 저장소를 받지 못했다).
   */
  private Store connectWithUidPlus(EmailAccountResponse account, String password)
      throws MessagingException {
    Store store = imapConnector.connect(account, password);
    try {
      if (!uidPlus((IMAPStore) store)) {
        throw MailTrashException.of(MailTrashException.PERMANENT_DELETE_UNSUPPORTED);
      }
      return store;
    } catch (MessagingException | RuntimeException e) {
      closeQuietly(store);
      throw e;
    }
  }

  /**
   * 지금 LIST 로 찾은 서버 휴지통이 휴지통 행 이름과 같은지. 다르면 지난 목록 갱신 뒤 서버 휴지통이 바뀐 것이다 — 휴지통 행 이름의 메일함은 이제 휴지통이 아닐 수
   * 있어(사용자 메일함일 수 있다) 지우면 안 된다.
   */
  private static boolean trashUnchanged(Store store, TrashRef trash, long accountId)
      throws MessagingException {
    if (trash.name().equals(ImapFolderEntries.findTrash(store))) {
      return true;
    }
    log.warn("IMAP 휴지통 지우기 건너뜀 — 서버 휴지통이 목록 갱신 뒤 바뀜: accountId={}", accountId);
    return false;
  }

  /**
   * 휴지통을 READ_WRITE 로 열고 메일들을 지운다. 서버 위치(UID)를 모르는 메일은 실패, 서버에 이미 없는 UID 는 성공. 메일함 단위 명령(열기·플래그·UID
   * EXPUNGE)이 실패하면 아직 결과가 없는 메일은 모두 실패다.
   */
  private List<Outcome> eraseInTrash(
      long accountId, Store store, TrashRef trash, List<Item> items) {
    List<Outcome> out = new ArrayList<>();
    List<Item> withUid = new ArrayList<>();
    for (Item it : items) {
      if (it.imapUid() == null) {
        out.add(Outcome.failed(it.messageId(), MailServerErrors.NOT_FOUND)); // 서버 위치를 모르는 로컬 행
      } else {
        withUid.add(it);
      }
    }
    if (withUid.isEmpty()) {
      return out;
    }
    IMAPFolder folder = null;
    try {
      folder = openTrash(store, trash.name());
      if (!uidValidityMatches(folder, trash.uidValidity())) {
        // 저장된 UID 가 다른 메일을 가리킬 수 있다 — 지우지 않는다(다음 동기화가 UIDVALIDITY 변경을 감지해 다시 받는다).
        log.warn("IMAP 완전 삭제 건너뜀 — 휴지통 UIDVALIDITY 불일치: accountId={}", accountId);
        out.addAll(failedAll(withUid, MailServerErrors.MAILBOX_CHANGED));
        return out;
      }
      long[] uids = withUid.stream().mapToLong(Item::imapUid).toArray();
      Message[] found = folder.getMessagesByUID(uids);
      List<Item> present = new ArrayList<>();
      List<Message> msgs = new ArrayList<>();
      for (int i = 0; i < uids.length; i++) {
        if (found[i] == null) {
          out.add(Outcome.ok(withUid.get(i).messageId())); // 다른 곳에서 이미 지웠다 — 목표 상태
        } else {
          present.add(withUid.get(i));
          msgs.add(found[i]);
        }
      }
      eraseMessages(accountId, folder, msgs);
      present.forEach(it -> out.add(Outcome.ok(it.messageId())));
      return out;
    } catch (MessagingException | RuntimeException e) {
      log.warn("IMAP 완전 삭제 실패: accountId={} {}", accountId, e.getClass().getSimpleName());
      List<Long> done = out.stream().map(Outcome::messageId).toList();
      for (Item it : withUid) {
        if (!done.contains(it.messageId())) {
          out.add(Outcome.failed(it.messageId(), MailServerErrors.ERASE_FAILED));
        }
      }
      return out;
    } finally {
      closeQuietly(folder);
    }
  }

  /** 휴지통을 READ_WRITE 로 연다(지울 표시·UID EXPUNGE 에 필요). */
  private static IMAPFolder openTrash(Store store, String name) throws MessagingException {
    IMAPFolder folder = (IMAPFolder) store.getFolder(name);
    folder.open(Folder.READ_WRITE);
    return folder;
  }

  /** 휴지통 행에 기록된 UIDVALIDITY 가 있고 지금 서버 값과 같은지 — 같을 때만 저장된 UID 가 같은 메일을 가리킨다. */
  private static boolean uidValidityMatches(IMAPFolder folder, Long recorded)
      throws MessagingException {
    return recorded != null && recorded == folder.getUIDValidity();
  }

  /**
   * 메일들에 {@code \Deleted} 를 붙이고 그 메일만 {@code UID EXPUNGE} 한다. 비어 있으면 아무 명령도 보내지 않는다 — {@code
   * expunge} 에 빈 배열·null 을 넘기면 일반 EXPUNGE 가 될 수 있다(클래스 주석). 테스트가 묶음 명령 실패·연결 끊김을 흉내 내려고 덮어쓴다.
   *
   * <p>표시는 붙었는데 UID EXPUNGE 가 실패하면 그 메일들의 {@code \Deleted} 를 best-effort 로 되돌린다 — 표시가 남으면 나중에 다른
   * 클라이언트의 일반 EXPUNGE·압축이 앱이 「지우지 못했다」고 알린 메일을 지운다. 되돌리기 실패는 삼키고(로그는 계정 id·예외 종류만) 원래 실패를 던진다.
   */
  protected void eraseMessages(long accountId, IMAPFolder folder, List<Message> msgs)
      throws MessagingException {
    if (msgs.isEmpty()) {
      return;
    }
    Message[] arr = msgs.toArray(Message[]::new);
    folder.setFlags(arr, new Flags(Flags.Flag.DELETED), true);
    try {
      expungeFlagged(folder, arr);
    } catch (MessagingException | RuntimeException e) {
      unflagQuietly(accountId, folder, arr);
      throw e;
    }
  }

  /** 지울 표시를 붙인 그 메일만 {@code UID EXPUNGE} 한다(비어 있지 않은 배열). 테스트가 EXPUNGE 실패를 흉내 내려고 덮어쓴다. */
  protected void expungeFlagged(IMAPFolder folder, Message[] msgs) throws MessagingException {
    folder.expunge(msgs);
  }

  /** EXPUNGE 가 실패한 메일들의 {@code \Deleted} 를 되돌린다 — 실패(연결 끊김 등)는 결과를 바꾸지 않아 경고만 남긴다. */
  private static void unflagQuietly(long accountId, IMAPFolder folder, Message[] msgs) {
    try {
      folder.setFlags(msgs, new Flags(Flags.Flag.DELETED), false);
    } catch (MessagingException | RuntimeException e) {
      log.warn("IMAP 지울 표시 되돌리기 실패: accountId={} {}", accountId, e.getClass().getSimpleName());
    }
  }

  /** 모든 메일을 같은 문구로 실패 처리한다. */
  private static List<Outcome> failedAll(List<Item> items, String error) {
    return items.stream().map(it -> Outcome.failed(it.messageId(), error)).toList();
  }

  /** 메일함을 expunge 없이 닫는다(close(false)) — 결과에 영향 없는 실패는 삼킨다. */
  private static void closeQuietly(Folder folder) {
    if (folder != null && folder.isOpen()) {
      try {
        folder.close(false);
      } catch (MessagingException ignored) {
        // 결과에 영향 없음
      }
    }
  }

  /** 저장소 연결을 닫는다 — 결과에 영향 없는 실패는 삼킨다. */
  private static void closeQuietly(Store store) {
    if (store != null) {
      try {
        store.close();
      } catch (MessagingException ignored) {
        // 결과에 영향 없음
      }
    }
  }
}
