import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import playwright from 'eslint-plugin-playwright'
import globals from 'globals'
import tseslint from 'typescript-eslint'

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
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      // 신규 권장 규칙이지만 강제는 부담 — 페이지/훅 패턴 정리 시점에 점진 해결
      'react-hooks/set-state-in-effect': 'warn',
      // 날짜/시간 표시는 공용 포매터(src/lib/formatters.ts)로만 — 화면마다 toLocale* 직접 호출이
      // 난립해 표기 불일치(#617)가 반복됐다. 문서만으로는 재발을 못 막아 린트로 강제한다(#632).
      'no-restricted-syntax': ['error', toLocaleRule, srcDocIframeRule, headerBarRule],
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
      'no-restricted-syntax': ['error', toLocaleRule, srcDocIframeRule],
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
    rules: {
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
