import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import playwright from 'eslint-plugin-playwright'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import noDirectSparkles from './eslint-rules/no-direct-sparkles.js'
import noRawAiHue from './eslint-rules/no-raw-ai-hue.js'
import requireE2eReasonTag from './eslint-rules/require-e2e-reason-tag.js'
import untaggedBaseline from './e2e/untagged-baseline.json' with { type: 'json' }

// no-restricted-syntax 항목 — 예외 블록이 일부만 다시 켤 수 있도록 상수로 둔다.
// 날짜/시간 표시는 공용 포매터(src/lib/formatters.ts)로만 — 화면마다 toLocale* 직접 호출이
// 난립해 표기 불일치(#617)가 반복됐다. 문서만으로는 재발을 못 막아 린트로 강제한다(#632).
const toLocaleRule = {
  selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
  message:
    '날짜/시간 표시는 toLocale*String 직접 호출 대신 공용 포매터(src/lib/formatters.ts)를 사용하세요. 필요한 포맷이 없으면 포매터를 추가하세요. (docs/CODING_CONVENTION.md "날짜/시간 표시 포맷" 참조)',
}
// srcDoc iframe 은 sandbox 격리·슬림 스크롤바 주입을 빠뜨리기 쉽다 — 드라이브만 고치고 메일이 남았던 일(WP-274→275).
const srcDocIframeRule = {
  selector: "JSXOpeningElement[name.name='iframe'] > JSXAttribute[name.name='srcDoc']",
  message:
    'srcDoc iframe 은 직접 쓰지 말고 SandboxedHtmlFrame(src/components/SandboxedHtmlFrame.tsx)을 사용하세요 — sandbox 격리와 슬림 스크롤바 주입을 함께 맡습니다.',
}
// 링크 안에 버튼을 중첩하면 탭 정지가 둘(링크 + 버튼)이고 스크린리더는 이름 없는 링크로 읽는다 — 팀 머리만 고치고
// 개인 머리가 남았던 일(WP-1415→1435). 버튼 모양 링크는 Button asChild 로 링크 하나를 만든다.
const nestedButtonInLinkRule = {
  selector:
    'JSXElement[openingElement.name.name=/^(Link|NavLink|a)$/] JSXElement[openingElement.name.name=/^(Button|button)$/]',
  message:
    '링크 안에 버튼을 넣지 마세요 — 탭 정지가 둘이 됩니다. 버튼 모양 링크는 <Button asChild><Link …>…</Link></Button> 로 쓰세요(WP-1435).',
}
// role="button" 요소 안의 컨트롤 금지 — role=button 의 자식은 표현용(presentational)이라
// 스크린리더가 안쪽 버튼·링크·메뉴 버튼을 따로 읽지 못한다(WP-1544·1547·1550).
// 바깥 요소 자신의 여는 태그에 role="button" 이 있을 때만 보고(자손의 role 은 무시), 안쪽은 어느 깊이든 잡는다.
// esquery 는 :has(> A > B) 처럼 이어진 자식 경로를 못 읽어서 :has 를 겹쳐 쓴다.
// 이름 목록은 전부가 아니다 — 버튼을 그리는 앱 컴포넌트(AiSignalBadge 처럼 onClick 이면 <button>)는 생길 때마다 더한다.
// role={'button'}·조건식 role 은 잡지 않는다(리터럴 속성만).
const nestedControlInRoleButtonRule = {
  selector:
    "JSXElement:has(> JSXOpeningElement:has(> JSXAttribute[name.name='role'][value.value='button'])) JSXElement[openingElement.name.name=/^(button|Button|a|Link|NavLink|DropdownMenuTrigger|AiSignalBadge)$/]",
  message:
    'role="button" 요소 안에 버튼·링크·메뉴 버튼을 넣지 마세요 — 스크린리더가 안쪽 컨트롤을 따로 읽지 못합니다. 행은 클릭만 받고, 행 안의 열기 버튼 하나를 키보드 접근점으로 두세요(WP-1550).',
}
// 페이지 헤더 바를 화면에서 직접 만들면 높이·여백·폭이 다시 갈라진다 — Page.Header / PanelHeader / subPaneHeaderClass 를 쓴다.
// 헤더 바(h-14 + border-b) 직접 생성 금지 — 한 className 속성 안이면 문자열·템플릿 조각이 나뉘어 있어도 잡는다.
// 예) className="flex h-14 border-b" · cn('flex h-14', 'border-b') · `h-14 ${x} border-b` · cn(`h-14`, 'border-b').
const H14 = '/(^|\\s)h-14(\\s|$)/'
const BORDER_B = '/(^|\\s)border-b(\\s|$)/'
const headerBarMessage =
  '헤더 바(h-14 + border-b)는 직접 만들지 말고 Page.Header(src/components/layout/Page.tsx) 또는 PanelHeader 를 사용하세요.'
const headerBarRule = {
  selector: [
    `Literal[value=${H14}]`,
    `TemplateElement[value.raw=${H14}]`,
  ]
    .flatMap((h) =>
      [`Literal[value=${BORDER_B}]`, `TemplateElement[value.raw=${BORDER_B}]`].map(
        (b) => `JSXAttribute[name.name='className']:has(${h}):has(${b})`,
      ),
    )
    .join(', '),
  message: headerBarMessage,
}

// no-restricted-syntax 전체 목록 — 예외 블록은 이 목록에서 뺄 항목만 filter 로 고른다.
// 블록마다 목록을 손으로 다시 적으면 새 항목을 더할 때 예외 블록에서만 조용히 빠진다.
const restrictedSyntaxRules = [toLocaleRule, srcDocIframeRule, headerBarRule, nestedButtonInLinkRule, nestedControlInRoleButtonRule]

// 팝퍼(팝오버·선택 창·메뉴) 직접 가져오기 금지 — 앱 공용 래퍼(src/components/overlay)만 하단 탭바를 피한다(WP-806).
const popperImportMessage =
  'Popover·Select·DropdownMenu 는 @/components/overlay/* 에서 가져오세요 — 휴대폰 하단 탭바를 피하는 충돌 여백이 거기서 들어갑니다(WP-806).'
// shadcn 원본(ui/*)과 Radix 개별 패키지(@radix-ui/react-*)
const popperImportPattern = {
  regex: '((^|/)ui/(popover|select|dropdown-menu)|^@radix-ui/react-(popover|select|dropdown-menu))$',
  message: popperImportMessage,
}
// WP-1352: 검색·필터 입력칸의 공용 바탕(query-input)은 SearchInput·FilterInput 만 쓴다 — 화면이 바로 쓰면
// 아이콘·지우기 문구를 마음대로 골라 검색과 필터 구분이 무너진다. (ui/ 는 globalIgnores 라 두 래퍼는 걸리지 않는다.)
const queryInputImportPattern = {
  regex: '(^|/)ui/query-input$',
  message: '목록을 좁히면 FilterInput, 상단 검색이면 SearchInput 을 쓰세요 — query-input 은 두 컴포넌트의 공용 바탕입니다(WP-1352).',
}
// 통합 패키지 radix-ui — Slot·Dialog 등은 그대로 쓰고 팝퍼 셋만 막는다.
const radixPopperPackageRule = {
  name: 'radix-ui',
  importNames: ['Popover', 'Select', 'DropdownMenu'],
  message: popperImportMessage,
}

// WP-1549: dnd-kit useSortable 은 aria-roledescription 기본값이 영어 「sortable」이라 스크린리더가 영어로 읽는다.
// 한국어 설명을 넣는 공용 훅(src/lib/dnd/useSortableItem)만 쓰게 해 새 정렬 목록에서 다시 빠지지 않게 막는다.
const sortableHookRule = {
  name: '@dnd-kit/sortable',
  importNames: ['useSortable'],
  message: 'useSortable 대신 @/lib/dnd/useSortableItem 을 쓰세요 — 스크린리더 설명(aria-roledescription)을 한국어로 넣습니다(WP-1549).',
}

// AI 표식 규칙(WP-1529) — Sparkles 직접 import·보라 계열 원색 클래스를 막는다. 문서(디자인 시스템 §7.2)만으로는
// 화면마다 표식이 다시 갈라지는 걸 못 막아 린트로 강제한다. 기존 no-restricted-* 에 넣으면 예외 블록마다
// 다른 항목을 다시 나열해야 해서, 별도 규칙 id 로 두고 예외는 'off' 한 줄로 끝낸다.
const aiMarkerPlugin = {
  rules: { 'no-direct-sparkles': noDirectSparkles, 'no-raw-ai-hue': noRawAiHue },
}

// 테스트 면제 glob — 단위 테스트와 e2e 를 나눠 면제 범위를 다르게 둔다.
const UNIT_TEST_GLOBS = ['src/**/*.test.{ts,tsx}', 'src/test/**']
const E2E_GLOBS = ['e2e/**/*.ts']

export default defineConfig([
  globalIgnores(['dist', 'src/components/ui', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    // E2E 는 아래 전용 블록만 적용 — 앱용 React·import 정렬 규칙을 스펙 267개에 걸지 않는다.
    ignores: ['e2e/**'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'simple-import-sort': simpleImportSort,
      'ai-marker': aiMarkerPlugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // AI 표식은 @/components/ai 프리미티브로만, 보라 계열 원색은 시맨틱 토큰(ai-accent 등)으로만(WP-1529).
      'ai-marker/no-direct-sparkles': 'error',
      'ai-marker/no-raw-ai-hue': 'error',
      // 신규 권장 규칙이지만 강제는 부담 — 페이지/훅 패턴 정리 시점에 점진 해결
      'react-hooks/set-state-in-effect': 'warn',
      // 날짜/시간 표시는 공용 포매터(src/lib/formatters.ts)로만 — 화면마다 toLocale* 직접 호출이
      // 난립해 표기 불일치(#617)가 반복됐다. 문서만으로는 재발을 못 막아 린트로 강제한다(#632).
      'no-restricted-syntax': ['error', ...restrictedSyntaxRules],
      // 팝오버·선택 창·메뉴는 앱 공용 래퍼(src/components/overlay)로만 — 휴대폰 하단 탭바를 피하는 충돌 여백이
      // 거기서 한 번에 들어간다(WP-806). ui/* 나 Radix 원본을 직접 쓰면 그 화면만 탭바 밑으로 펼쳐진다.
      // (src/components/ui 는 globalIgnores 라 shadcn 원본의 radix-ui 가져오기는 걸리지 않는다.)
      'no-restricted-imports': ['error', { paths: [radixPopperPackageRule, sortableHookRule], patterns: [popperImportPattern, queryInputImportPattern] }],
    },
  },
  {
    // 앱 공용 팝퍼 래퍼 — shadcn 원본(ui/*)을 감싸는 유일한 자리.
    files: ['src/components/overlay/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    // 공용 포매터 구현부만 toLocale* 직접 호출 허용 — 규칙의 유일한 예외.
    files: ['src/lib/formatters.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // 헤더 틀 구현부(layout)와 모바일 헤더는 h-14 + border-b 를 직접 쓴다 — 헤더 규칙만 해제하고 나머지 두 규칙은 유지.
    files: ['src/components/layout/**', 'src/components/mobile/**', 'src/**/mobile/**'],
    rules: {
      'no-restricted-syntax': ['error', ...restrictedSyntaxRules.filter((r) => r !== headerBarRule)],
    },
  },
  {
    // AI 프리미티브 구현부 — Sparkles 를 실제로 import 하는 유일한 자리(AiIcon 등).
    files: ['src/components/ai/**'],
    rules: { 'ai-marker/no-direct-sparkles': 'off' },
  },
  {
    // 사용자가 고르는 categorical 팔레트 — 원색 클래스가 데이터다(01-design-tokens §1-7 승인 예외, AI 와 무관).
    files: ['src/lib/labelColors.ts', 'src/lib/calendarPalette.ts'],
    rules: { 'ai-marker/no-raw-ai-hue': 'off' },
  },
  {
    // 단위 테스트 — 팔레트 클래스 단언·아이콘 모양 비교에 원색·Sparkles 이름이 필요하다.
    files: UNIT_TEST_GLOBS,
    rules: { 'ai-marker/no-direct-sparkles': 'off', 'ai-marker/no-raw-ai-hue': 'off' },
  },
  {
    // e2e 스펙 — 색 클래스 단언만 원색이 필요하다. Sparkles 직접 import 는 e2e 에서도 계속 막는다.
    files: E2E_GLOBS,
    rules: { 'ai-marker/no-raw-ai-hue': 'off' },
  },
  // 컴포넌트 테스트·테스트 헬퍼 — HMR 경계가 아니므로 컴포넌트 외 export(헬퍼·픽스처)를 허용한다(WP-413).
  {
    files: ['src/test/**', 'src/**/*.test.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // 서비스워커 — clients·registration 등 SW 전역 사용. React 규칙 무관.
  {
    files: ['src/sw.ts'],
    languageOptions: { globals: globals.serviceworker },
  },
  // E2E — Playwright 규칙만 적용한다. 비동기 타이밍 의존(고정 대기·1회 읽기·await 누락)의 재유입을 막는다(WP-225).
  {
    files: ['e2e/**/*.ts'],
    extends: [playwright.configs['flat/recommended']],
    languageOptions: { parser: tseslint.parser },
    plugins: { e2e: { rules: { 'require-reason-tag': requireE2eReasonTag } } },
    rules: {
      // 테스트마다 브라우저가 필요한 이유 태그 — 이관 전 테스트는 파일별 기준선만큼 허용(WP-971, 규칙 머리 주석).
      'e2e/require-reason-tag': ['error', { baseline: untaggedBaseline }],
      // 타이밍 의존을 숨기거나 만드는 패턴 — 부재 확인처럼 불가피한 고정 대기는 사유와 함께 disable 주석으로 둔다(WP-82).
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-wait-for-selector': 'error',
      'playwright/no-force-option': 'error',
      // 비동기와 무관한 스타일 규칙은 끈다 — lint-staged 의 --fix 가 손대는 파일마다 무관한 diff 를 만들지 않게.
      'playwright/no-useless-not': 'off',
      'playwright/consistent-spacing-between-blocks': 'off',
      'playwright/prefer-to-have-length': 'off',
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-conditional-expect': 'off',
      'playwright/no-skipped-test': 'off',
      'playwright/expect-expect': 'off',
    },
  },
])
