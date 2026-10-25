package com.workplace.mail;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.service.folder.FolderRole;
import com.workplace.mail.service.folder.ImapFolderClassifier;
import com.workplace.mail.service.folder.ImapFolderClassifier.Entry;
import com.workplace.mail.service.folder.ImapFolderClassifier.Kind;
import com.workplace.mail.service.folder.ServerFolder;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * IMAP 메일함 역할 판별 단위 테스트(WP-960). GreenMail 은 SPECIAL-USE 속성을 주지 않아 통합 테스트로는 이름 판별만 지나므로, 속성 기반
 * 판별·한글 이름·Gmail 숨김·\Noselect 묶음 노드 규칙을 여기서 직접 검증한다.
 */
class ImapFolderClassifierTest {

  /** 메일을 담는 폴더 항목. */
  private static Entry box(String fullName, char sep, String... attrs) {
    return new Entry(fullName, sep, List.of(attrs), true);
  }

  /** \Noselect 묶음 폴더 항목. */
  private static Entry noselect(String fullName, char sep) {
    return new Entry(fullName, sep, List.of("\\Noselect", "\\HasChildren"), false);
  }

  private static Map<String, ServerFolder> byKey(List<ServerFolder> folders) {
    return folders.stream().collect(Collectors.toMap(ServerFolder::key, Function.identity()));
  }

  @Test
  void specialUseAttributes_winOverNames() {
    // 이름은 사용자 폴더처럼 보여도 속성이 시스템이면 숨김, \Archive 면 보관.
    assertThat(ImapFolderClassifier.kindOf(box("Mein Archiv", '/', "\\Archive")))
        .isEqualTo(Kind.ARCHIVE);
    assertThat(ImapFolderClassifier.kindOf(box("Gesendet", '/', "\\HasNoChildren", "\\Sent")))
        .isEqualTo(Kind.SYSTEM);
    assertThat(ImapFolderClassifier.kindOf(box("Papierkorb", '/', "\\TRASH")))
        .isEqualTo(Kind.SYSTEM);
    assertThat(ImapFolderClassifier.kindOf(box("Entwürfe", '/', "\\Drafts")))
        .isEqualTo(Kind.SYSTEM);
    assertThat(ImapFolderClassifier.kindOf(box("Werbung", '/', "\\Junk"))).isEqualTo(Kind.SYSTEM);
    assertThat(ImapFolderClassifier.kindOf(box("Alle", '/', "\\All"))).isEqualTo(Kind.SYSTEM);
    assertThat(ImapFolderClassifier.kindOf(box("Stern", '/', "\\Flagged"))).isEqualTo(Kind.SYSTEM);
    assertThat(ImapFolderClassifier.kindOf(box("Wichtig", '/', "\\Important")))
        .isEqualTo(Kind.SYSTEM);
    // 속성이 있으면 이름이 "Sent" 여도 속성을 따른다
    assertThat(ImapFolderClassifier.kindOf(box("Sent", '/', "\\Archive"))).isEqualTo(Kind.ARCHIVE);
  }

  @Test
  void names_englishAndKorean_withoutAttributes() {
    assertThat(ImapFolderClassifier.kindOf(box("INBOX", '.'))).isEqualTo(Kind.INBOX);
    assertThat(ImapFolderClassifier.kindOf(box("inbox", '.'))).isEqualTo(Kind.INBOX);
    for (String archive : List.of("Archive", "ARCHIVES", "보관", "보관함")) {
      assertThat(ImapFolderClassifier.kindOf(box(archive, '/')))
          .as(archive)
          .isEqualTo(Kind.ARCHIVE);
    }
    for (String system :
        List.of(
            "Sent",
            "Sent Items",
            "Sent Messages",
            "보낸편지함",
            "보낸 메일함",
            "Drafts",
            "임시보관함",
            "Trash",
            "Deleted",
            "Deleted Items",
            "Deleted Messages",
            "휴지통",
            "Junk",
            "Junk E-mail",
            "Junk Email",
            "Spam",
            "스팸",
            "스팸메일함",
            "Outbox",
            "보낼편지함")) {
      assertThat(ImapFolderClassifier.kindOf(box(system, '/'))).as(system).isEqualTo(Kind.SYSTEM);
    }
    assertThat(ImapFolderClassifier.kindOf(box("고객사", '/'))).isEqualTo(Kind.USER);
  }

  @Test
  void names_applyOnlyAtTopOrDirectlyUnderInbox() {
    // Courier/Cyrus 식 INBOX 아래 시스템 폴더는 이름으로 판별
    assertThat(ImapFolderClassifier.kindOf(box("INBOX.Sent", '.'))).isEqualTo(Kind.SYSTEM);
    assertThat(ImapFolderClassifier.kindOf(box("INBOX.Archive", '.'))).isEqualTo(Kind.ARCHIVE);
    // 사용자 폴더 깊은 곳의 같은 이름은 사용자 폴더 그대로
    assertThat(ImapFolderClassifier.kindOf(box("고객사.Trash", '.'))).isEqualTo(Kind.USER);
    assertThat(ImapFolderClassifier.kindOf(box("프로젝트/Archive", '/'))).isEqualTo(Kind.USER);
  }

  @Test
  void gmail_systemTreeHidden_userLabelsVisible() {
    List<Entry> entries =
        List.of(
            box("INBOX", '/'),
            noselect("[Gmail]", '/'),
            box("[Gmail]/All Mail", '/', "\\All"),
            box("[Gmail]/Sent Mail", '/', "\\Sent"),
            box("[Gmail]/Starred", '/', "\\Flagged"),
            box("[Gmail]/Custom", '/'), // 속성이 없어도 [Gmail] 아래는 숨김
            box("[Google Mail]/Bin", '/', "\\Trash"),
            box("Receipts", '/'),
            box("Receipts/2025", '/'));

    Map<String, ServerFolder> kept = byKey(ImapFolderClassifier.classify(entries));

    assertThat(kept).containsOnlyKeys("Receipts", "Receipts/2025");
    assertThat(kept.get("Receipts").role()).isEqualTo(FolderRole.USER);
    assertThat(kept.get("Receipts").parentKey()).isNull();
    assertThat(kept.get("Receipts/2025").parentKey()).isEqualTo("Receipts");
    assertThat(kept.get("Receipts/2025").displayName()).isEqualTo("2025");
  }

  @Test
  void hierarchy_parentsUnderInboxOrSystemBecomeTopLevel_archiveChildrenLinked() {
    List<Entry> entries =
        List.of(
            box("INBOX", '.'),
            box("INBOX.팀 공지", '.'),
            box("Archive", '.'),
            box("Archive.2025 프로젝트", '.'),
            box("Trash", '.'),
            box("Trash.복구할 것", '.'),
            box("고객사", '.'),
            box("고객사.A사", '.'));

    Map<String, ServerFolder> kept = byKey(ImapFolderClassifier.classify(entries));

    assertThat(kept)
        .containsOnlyKeys(
            "INBOX.팀 공지", "Archive", "Archive.2025 프로젝트", "Trash.복구할 것", "고객사", "고객사.A사");
    assertThat(kept.get("INBOX.팀 공지").parentKey()).isNull();
    assertThat(kept.get("INBOX.팀 공지").displayName()).isEqualTo("팀 공지");
    assertThat(kept.get("Archive").role()).isEqualTo(FolderRole.ARCHIVE);
    assertThat(kept.get("Archive.2025 프로젝트").role()).isEqualTo(FolderRole.USER);
    assertThat(kept.get("Archive.2025 프로젝트").parentKey()).isEqualTo("Archive");
    assertThat(kept.get("Trash.복구할 것").parentKey()).isNull();
    assertThat(kept.get("고객사.A사").parentKey()).isEqualTo("고객사");
    assertThat(kept.values()).allMatch(ServerFolder::selectable);
    assertThat(kept.values()).allMatch(f -> f.unread() == null && f.total() == null);
  }

  @Test
  void noselect_keptOnlyWithVisibleDescendants() {
    List<Entry> entries =
        List.of(
            noselect("묶음", '/'),
            noselect("묶음/중간", '/'),
            box("묶음/중간/실제", '/'),
            noselect("빈 묶음", '/'),
            noselect("빈 묶음/더 빈", '/'));

    Map<String, ServerFolder> kept = byKey(ImapFolderClassifier.classify(entries));

    assertThat(kept).containsOnlyKeys("묶음", "묶음/중간", "묶음/중간/실제");
    assertThat(kept.get("묶음").selectable()).isFalse();
    assertThat(kept.get("묶음/중간").selectable()).isFalse();
    assertThat(kept.get("묶음/중간").parentKey()).isEqualTo("묶음");
    assertThat(kept.get("묶음/중간/실제").selectable()).isTrue();
    assertThat(kept.get("묶음/중간/실제").parentKey()).isEqualTo("묶음/중간");
  }

  @Test
  void flatNamespace_noSeparator() {
    List<ServerFolder> kept =
        ImapFolderClassifier.classify(List.of(box("INBOX", '\0'), box("a/b", '\0')));
    assertThat(kept)
        .singleElement()
        .satisfies(
            f -> {
              assertThat(f.key()).isEqualTo("a/b");
              assertThat(f.displayName()).isEqualTo("a/b");
              assertThat(f.parentKey()).isNull();
            });
  }

  /** WP-962 휴지통 찾기 — SPECIAL-USE 우선, 없으면 최상위·INBOX 아래·Gmail 묶음 아래 이름만(깊은 곳 사용자 폴더는 아님). */
  @Test
  void findTrash_prefersSpecialUse_thenNamesAtSystemLevelsOnly() {
    assertThat(
            ImapFolderClassifier.findTrash(
                List.of(box("Trash", '/'), box("Bin2", '/', "\\HasNoChildren", "\\Trash"))))
        .isEqualTo("Bin2");
    assertThat(ImapFolderClassifier.findTrash(List.of(box("INBOX", '.'), box("INBOX.Trash", '.'))))
        .isEqualTo("INBOX.Trash");
    assertThat(ImapFolderClassifier.findTrash(List.of(box("[Gmail]/휴지통", '/'))))
        .isEqualTo("[Gmail]/휴지통");
    assertThat(
            ImapFolderClassifier.findTrash(
                List.of(box("Deleted Messages", '/'), box("Trash", '/'))))
        .isEqualTo("Trash");
    assertThat(
            ImapFolderClassifier.findTrash(List.of(box("고객사/Trash", '/'), noselect("Trash", '/'))))
        .isNull();
  }
}
