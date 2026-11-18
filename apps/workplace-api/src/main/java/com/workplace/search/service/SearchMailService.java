package com.workplace.search.service;

import com.workplace.mail.dto.MailListCursor;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.repository.EmailMessageRepository.AllFolderSearchRow;
import com.workplace.mail.service.folder.MailFolderLabels;
import com.workplace.mail.util.MailAddresses;
import com.workplace.mail.util.MailAddresses.Person;
import com.workplace.search.dto.MailSearchHit;
import com.workplace.search.dto.MailSearchPage;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 통합 검색 팔레트(WP-1359)의 메일 검색 — 호출자의 모든 활성 계정에서 휴지통·스팸·임시보관함을 뺀 모든 메일함을 한 번에 찾아 최신순으로 합친다. 검색
 * 규칙(제목·보낸 사람·본문 FTS)은 메일함 화면 검색과 같은 조건({@link EmailMessageRepository#searchTermCondition})을 쓴다. 계정
 * 접근은 메일함 목록과 같이 「본인 소유 + 비활성 아님」이다.
 */
@Service
@RequiredArgsConstructor
public class SearchMailService {

  /** 최소 검색어 길이(공백 뺀 길이 미만이면 빈 결과) — 웹 provider 의 isSearchable 과 같다. */
  private static final int MIN_QUERY = 2;

  static final String KIND_INBOX = "INBOX";
  static final String KIND_SENT = "SENT";
  static final String KIND_OTHER = "OTHER";

  private final EmailMessageRepository messages;

  /** 한 페이지. RLS 때문에 읽기 트랜잭션 안에서 돈다. size+1 건을 읽어 다음 페이지 유무를 판정한다. */
  @Transactional(readOnly = true)
  public MailSearchPage search(long userId, String q, MailListCursor cursor, int size) {
    String query = q == null ? "" : q.strip();
    if (query.replaceAll("\\s+", "").length() < MIN_QUERY) {
      return new MailSearchPage(List.of(), false);
    }
    List<AllFolderSearchRow> rows = messages.searchAllFolders(userId, query, cursor, size + 1);
    boolean hasMore = rows.size() > size;
    List<AllFolderSearchRow> page = hasMore ? rows.subList(0, size) : rows;
    return new MailSearchPage(page.stream().map(SearchMailService::toHit).toList(), hasMore);
  }

  /** 행 → 결과. 메일함 종류에 따라 이름·폴더 id·받는 사람을 채운다. */
  private static MailSearchHit toHit(AllFolderSearchRow r) {
    String kind = kindOf(r);
    String firstRecipient = null;
    int recipientCount = 0;
    if (KIND_SENT.equals(kind)) {
      // 보낸편지함의 보낸 사람은 늘 나라서, 화면은 받는 사람을 보인다(「받는 사람 ○○ 외 N명」).
      List<Person> to = MailAddresses.parsePeople(r.toAddresses());
      recipientCount = to.size();
      if (!to.isEmpty()) {
        Person first = to.get(0);
        firstRecipient = first.name() != null ? first.name() : first.address();
      }
    }
    return new MailSearchHit(
        r.id(),
        r.accountId(),
        r.subject(),
        r.snippet(),
        r.fromAddress(),
        r.fromName(),
        r.receivedAt(),
        kind,
        KIND_OTHER.equals(kind) ? r.folderId() : null,
        // 메일함 표시 이름 — 메일 화면과 같은 규칙(WP-1742 에서 MailFolderLabels 로 모음)
        MailFolderLabels.label(
            r.folderName(), r.folderDisplayName(), r.folderRole(), r.serverSent()),
        firstRecipient,
        recipientCount);
  }

  /**
   * 메일함 종류 — 보낸편지함(앱 기록·서버 보낸편지함)을 먼저 본다. 서버 보낸편지함이 「보관함」 같은 기타로 새지 않게. 판정은 별표 모아 보기(WP-1742)와 같은
   * {@link MailFolderLabels} 규칙.
   */
  private static String kindOf(AllFolderSearchRow r) {
    if (MailFolderLabels.isSent(r.folderName(), r.serverSent())) {
      return KIND_SENT;
    }
    if (MailFolderLabels.isInbox(r.folderName(), r.folderRole(), r.serverSent())) {
      return KIND_INBOX;
    }
    return KIND_OTHER;
  }
}
