package com.workplace.mail.service;

import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailSyncResult;
import com.workplace.mail.dto.ParsedAttachment;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.MailSyncException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailFolderRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import jakarta.mail.FetchProfile;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import jakarta.mail.UIDFolder;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * IMAP 받은편지함을 워크플레이스 DB 로 증분 동기화한다(v1 = INBOX, 온디맨드 폴링). UID 증분 커서(last_seen_uid)와 UIDVALIDITY 로
 * 중복/무효 데이터를 막는다:
 *
 * <ul>
 *   <li>UIDVALIDITY 가 바뀌면 서버가 UID 를 재사용하므로 폴더의 기존 메시지를 비우고 커서를 0 으로 리셋.
 *   <li>getMessagesByUID(start, LASTUID) 는 새 메일이 없어도 마지막 UID 1건을 돌려주므로(범위 클램핑), getUID &gt;
 *       last_seen_uid 인 것만 저장하고 insert 는 유니크 충돌 무시로 멱등 처리.
 * </ul>
 *
 * <p>현재는 수동 트리거 1회 동기화. IMAP IDLE/스케줄 푸시는 후속(#71 이후) 확장 여지로 남긴다. 네트워크 I/O 를 트랜잭션 안에서 수행하는 것은 개인
 * 메일함·수동 동기화라 허용하는 v1 단순화다. 동기화 직후 수행하는 동기 분류 호출도 동일한 v1 트레이드오프를 공유한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailSyncService {

  /** v1 동기화 대상 폴더. */
  private static final String INBOX = "INBOX";

  private final ImapConnector imapConnector;
  private final EmailAccountRepository accountRepo;
  private final EmailFolderRepository folderRepo;
  private final EmailMessageRepository messageRepo;
  private final EmailAttachmentRepository attachmentRepo;
  private final EncryptionService encryption;
  private final MailMessageParser parser;
  private final MailAiService mailAiService;

  /** 본인 계정의 INBOX 를 증분 동기화. 소유 아니면 404, 메일 서버 오류면 502. */
  @Transactional
  public MailSyncResult sync(long userId, long accountId) {
    EmailAccountResponse account =
        accountRepo
            .findByIdAndUser(userId, accountId)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    String password =
        accountRepo
            .findEncryptedPassword(userId, accountId)
            .map(encryption::decrypt)
            .orElseThrow(() -> new EmailAccountNotFoundException(accountId));

    EmailFolderRepository.FolderSyncState folder = folderRepo.ensureFolder(accountId, INBOX);

    Store store = null;
    Folder inbox = null;
    try {
      store = imapConnector.connect(account, password);
      inbox = store.getFolder(INBOX);
      inbox.open(Folder.READ_ONLY);
      UIDFolder uidFolder = (UIDFolder) inbox;

      long uidValidity = uidFolder.getUIDValidity();
      long lastSeenUid = folder.lastSeenUid();
      // UIDVALIDITY 변경 → UID 재사용 가능 → 기존 메시지 폐기 + 커서 리셋
      if (folder.uidValidity() != null && folder.uidValidity() != uidValidity) {
        messageRepo.deleteByFolder(folder.id());
        lastSeenUid = 0;
      }

      Message[] messages = uidFolder.getMessagesByUID(lastSeenUid + 1, UIDFolder.LASTUID);
      prefetch(inbox, messages);

      // 분류용 비서 사양 — 계정 AI 사용 시에만(미설정이면 null → 분류 생략). 메시지 수만큼 재해석 방지.
      AssistantSpec aiSpec = account.aiEnabled() ? mailAiService.resolveSpecOrNull(userId) : null;

      int fetched = 0;
      int saved = 0;
      long maxUid = lastSeenUid;
      for (Message msg : messages) {
        if (msg == null) {
          continue;
        }
        long uid = uidFolder.getUID(msg);
        if (uid <= lastSeenUid) {
          continue; // LASTUID 클램핑으로 끌려온 기존 메시지 — 건너뜀
        }
        fetched++;
        // 개별 메시지 파싱/저장 실패(깨진 charset·헤더 등)가 동기화 전체를 막지 않도록 격리한다.
        // 실패해도 아래에서 커서를 전진시켜 영구 재시도(무한 정지)를 방지한다.
        try {
          ParsedMessage parsed = parser.parse(uid, msg);
          Optional<Long> newId = messageRepo.insertIgnoreConflict(accountId, folder.id(), parsed);
          if (newId.isPresent()) {
            saved++;
            for (ParsedAttachment a : parsed.attachments()) {
              attachmentRepo.insert(newId.get(), a);
            }
            // 신규 INBOX 메시지만 분류(go-forward only). best-effort — 실패해도 동기화 지속.
            if (aiSpec != null) {
              mailAiService.classifyAndStore(newId.get(), parsed, aiSpec);
            }
          }
        } catch (Exception e) {
          // 자격증명 등 민감정보 노출 방지를 위해 uid 와 예외 요약만 기록한다.
          log.warn("메일 동기화 중 메시지 건너뜀 (uid={}): {}", uid, e.toString());
        }
        if (uid > maxUid) {
          maxUid = uid;
        }
      }

      folderRepo.updateSyncState(folder.id(), uidValidity, maxUid);
      return new MailSyncResult(fetched, saved);
    } catch (MessagingException e) {
      throw new MailSyncException("받은편지함 동기화에 실패했습니다", e);
    } finally {
      closeQuietly(inbox, store);
    }
  }

  /** 헤더/플래그/봉투/구조를 일괄 선반입해 메시지별 라운드트립을 줄인다(본문은 getContent 시 지연 로드). */
  private void prefetch(Folder inbox, Message[] messages) throws MessagingException {
    if (messages.length == 0) {
      return;
    }
    FetchProfile fp = new FetchProfile();
    fp.add(UIDFolder.FetchProfileItem.UID);
    fp.add(FetchProfile.Item.FLAGS);
    fp.add(FetchProfile.Item.ENVELOPE);
    fp.add(FetchProfile.Item.CONTENT_INFO);
    inbox.fetch(messages, fp);
  }

  private void closeQuietly(Folder inbox, Store store) {
    try {
      if (inbox != null && inbox.isOpen()) {
        inbox.close(false);
      }
    } catch (MessagingException ignored) {
      // 동기화 결과에 영향 없음
    }
    try {
      if (store != null) {
        store.close();
      }
    } catch (MessagingException ignored) {
      // 동기화 결과에 영향 없음
    }
  }
}
