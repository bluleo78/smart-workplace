package com.workplace.contacts;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.contacts.repository.ContactCursorCodec;
import org.junit.jupiter.api.Test;

/** 커서 round-trip 및 깨진 입력 방어. */
class ContactCursorCodecTest {

  @Test
  void roundTrip_preservesNameTypeId() {
    String c = ContactCursorCodec.encode("김철수", "MEMBER", 42L);
    ContactCursorCodec.Decoded d = ContactCursorCodec.decode(c);
    assertThat(d).isNotNull();
    assertThat(d.name()).isEqualTo("김철수");
    assertThat(d.type()).isEqualTo("MEMBER");
    assertThat(d.id()).isEqualTo(42L);
  }

  @Test
  void roundTrip_nameWithColonAndSpaces() {
    String c = ContactCursorCodec.encode("A: B (corp)", "EXTERNAL", 7L);
    ContactCursorCodec.Decoded d = ContactCursorCodec.decode(c);
    assertThat(d.name()).isEqualTo("A: B (corp)");
    assertThat(d.type()).isEqualTo("EXTERNAL");
    assertThat(d.id()).isEqualTo(7L);
  }

  @Test
  void decode_blankOrGarbage_returnsNull() {
    assertThat(ContactCursorCodec.decode(null)).isNull();
    assertThat(ContactCursorCodec.decode("")).isNull();
    assertThat(ContactCursorCodec.decode("!!!not-base64!!!")).isNull();
  }
}
