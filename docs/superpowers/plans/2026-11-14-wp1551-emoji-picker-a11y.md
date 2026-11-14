# WP-1551 이모지 선택 팝오버 — 접근 이름 — 구현 계획

이슈: WP-1551 (a11y, WCAG 4.1.2 이름·역할·값 / 1.1.1). 이모지 선택 팝오버(채팅 메시지 「이모지 추가」)가 이름 없는 dialog 이고, 안의 버튼 46개(빠른 6 + 전체 40)가 글리프만 있어 스크린리더가 이모지를 OS·엔진에 따라 영어 이름으로 읽거나 아예 「버튼」으로만 읽는다.

## 목표

- 팝오버(dialog)에 이름 「이모지 선택」.
- 이모지 버튼마다 한국어 이름 「<이름> 반응」(예: 「좋아요 반응」). 글리프 자체는 aria-hidden 대상 아님 — aria-label 이 이름을 대신한다.
- 같은 이모지 세트를 쓰는 다른 곳(이슈 코멘트 반응 팝오버·모바일 작업 시트 `QuickReactionRow`)도 지금 「👍 반응」처럼 글리프+「반응」 이름이라 같은 한국어 이름으로 맞춘다(같은 문제, 공용 헬퍼 하나).

## 설계 (내가 정한 것)

1. `src/components/reactions/emojiSets.ts` 에 `EMOJI_NAMES: Record<PickerEmoji, string>` — `PICKER_EMOJIS` 40종 모두의 짧은 한국어 이름(퀵 6종은 그 부분집합). 예: 👍 좋아요, 👎 싫어요, ❤️ 하트, 🔥 불꽃, 🎉 축하, 😄 웃음, 😅 진땀, 😂 눈물 나게 웃음, 🙂 미소, 😍 하트 눈, 🤔 생각 중, 😮 놀람, 😢 슬픔, 😡 화남, 🙏 부탁, 👏 박수, 🙌 만세, 💪 힘내, ✅ 확인, ❌ 아니오, 👀 보는 중, 🚀 로켓, 💯 100점, ✨ 반짝임, ⭐ 별, 💡 아이디어, 📌 고정, ⚡ 번개, 🐛 버그, 🛠️ 도구, ☕ 커피, 🍕 피자, 🎈 풍선, 🥳 파티, 😴 졸림, 🤯 머리 폭발, 😎 멋짐, 🤝 악수, 👋 손 인사, 💩 똥. 타입으로 40종 빠짐 없이 강제(`as const` 튜플에서 유니온 타입을 뽑아 Record 키로).
   - `emojiReactionLabel(emoji: string): string` — 이름이 있으면 「<이름> 반응」, 없으면(목록 밖 이모지 — 다른 사람이 단 반응 등) 「<글리프> 반응」(지금과 같은 대체).
2. `EmojiPicker.tsx`:
   - `PopoverContent` 에 `aria-label="이모지 선택"`.
   - 빠른 줄 `div` 에 `role="group" aria-label="자주 쓰는 반응"`, 전체 그리드에 `role="group" aria-label="모든 이모지"`.
   - 각 버튼 `aria-label={emojiReactionLabel(e)}`. testid·클래스·동작 그대로.
3. `CommentReactions.tsx`(이슈 코멘트 반응 팝오버): `PopoverContent` 에 `aria-label="이모지 선택"`, `EmojiButton` 의 aria-label 을 헬퍼로. 빠른 줄·그리드에 같은 group 이름. 주석의 「👍 반응」 예시 갱신.
4. `QuickReactionRow.tsx`(모바일 작업 시트·코멘트 반응 시트): aria-label 을 헬퍼로. 빠른 줄·그리드 group 이름(빠른 줄은 「이모지 더 보기」 버튼도 들어 있어 group 이름은 같은 「자주 쓰는 반응」으로 둔다).
5. 반응 칩(ReactionBar)·반응자 목록은 범위 밖(이 이슈는 선택 팝오버). 칩 이름은 그대로 둔다 — 보고에 남은 일로 적는다.
6. 보이는 화면은 바뀌지 않는다 — 매뉴얼 수정 불필요.

## 테스트

- 순수 테스트 `src/components/reactions/emojiSets.test.ts`(새 파일 허용 — 순수 함수, 고정 비용 작음): `PICKER_EMOJIS` 모두 이름이 있고 빈 문자열이 아니며 이름이 서로 겹치지 않는다; `emojiReactionLabel('👍')` = 「좋아요 반응」; 목록 밖 이모지는 「🦄 반응」.
- 화면 테스트 — 기존 파일에 단언 추가(새 화면 테스트 파일 금지):
  - `src/pages/chat/messageList.test.tsx` 「반응」 describe: 이모지 추가 버튼을 누르면 `getByRole('dialog', { name: '이모지 선택' })` 이 보이고, 그 안에 `getByRole('group', { name: '자주 쓰는 반응' })`·`'모든 이모지'`, `getByRole('button', { name: '좋아요 반응' })` 를 눌러 기존처럼 반응 요청이 나간다(기존 테스트가 testid 로 누르면 하나를 이름으로 바꿔 함께 본다). 이름 없는 버튼이 없음: dialog 안 모든 button 의 접근 이름이 비지 않고 글리프만이 아니다.
  - `src/pages/projects/issueCommentReactions.test.tsx`: 팝오버 dialog 이름과 버튼 하나의 이름.
  - `src/pages/mobile/issueCommentReactions.test.tsx`: 시트의 버튼 하나 이름(「좋아요 반응」).
  - 기존에 `name: '👍 반응'` 처럼 옛 이름으로 찾는 테스트(E2E 포함)를 `grep -rn "반응'" src e2e` 로 찾아 고친다.
  - 새 단언마다 헬퍼를 잠깐 깨(이름 대신 글리프) 실패하는지 확인 후 되돌린다.
- 돌릴 것(`apps/workplace-web`): 바꾼·더한 테스트 파일 vitest, `pnpm typecheck`, `pnpm lint`. 옛 이름에 기대는 E2E 가 있으면 그 spec 만.

## Review Focus

- `PICKER_EMOJIS` 에 `🛠️`·`❤️`·`☕`·`⭐`·`⚡` 처럼 변형 선택자(U+FE0F)가 붙은 것 — Record 키가 목록 문자열과 정확히 같아야 한다(복사해 쓰기, 타입이 강제).
- 다른 사람이 단 목록 밖 이모지로 헬퍼가 호출될 때 undefined 가 아니라 대체 문구.
- Radix PopoverContent 의 role=dialog 에 aria-label 이 실제로 붙는가(래퍼 `@/components/overlay/popover` 가 props 를 넘기는가).
- group 안 「이모지 더 보기」 버튼(모바일) 이름이 그대로인가.
- testid·클릭 동작·포커스 복귀(useReactionFocusRestore)가 바뀌지 않는가.
