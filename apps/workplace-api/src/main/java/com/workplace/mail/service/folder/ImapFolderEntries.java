package com.workplace.mail.service.folder;

import jakarta.mail.Folder;
import jakarta.mail.MessagingException;
import jakarta.mail.Store;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import org.eclipse.angus.mail.imap.IMAPFolder;

/**
 * IMAP LIST 응답을 {@link ImapFolderClassifier} 입력으로 바꾸는 공용 도구(WP-960·1681·1682). 메일함 목록 조회({@link
 * ImapFolderLister})·메일 옮기기·완전 삭제가 같은 규칙으로 서버 휴지통을 찾도록 한 곳에 둔다 — 규칙이 갈라지면 화면이 보여 주는 휴지통과 실제로 지우는
 * 휴지통이 달라질 수 있다.
 */
public final class ImapFolderEntries {

  private ImapFolderEntries() {}

  /**
   * LIST 응답 한 항목을 판별기 입력으로 바꾼다. 속성·구분자·종류는 LIST 응답에 이미 담겨 있어 추가 왕복이 없다. {@code \Noselect}·{@code
   * \NonExistent} 는 메일을 담지 못하는 묶음 노드로 본다.
   */
  public static ImapFolderClassifier.Entry toEntry(Folder f) throws MessagingException {
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

  /** LIST 로 서버 휴지통 전체 경로를 찾는다(SPECIAL-USE {@code \Trash} 또는 이름). 없으면 null. */
  public static String findTrash(Store store) throws MessagingException {
    List<ImapFolderClassifier.Entry> entries = new ArrayList<>();
    for (Folder f : store.getDefaultFolder().list("*")) {
      entries.add(toEntry(f));
    }
    return ImapFolderClassifier.findTrash(entries);
  }
}
