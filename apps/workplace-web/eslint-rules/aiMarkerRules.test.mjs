// AI 표식 린트 규칙(WP-1529) 단위 테스트 — ESLint RuleTester 를 vitest 에 연결해 두 로컬 규칙을 검증한다.
import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, it } from 'vitest'

import noDirectSparkles from './no-direct-sparkles.js'
import noRawAiHue from './no-raw-ai-hue.js'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

tester.run('no-direct-sparkles', noDirectSparkles, {
  valid: [
    "import { Bot, Loader2 } from 'lucide-react'",
    "import { AiIcon } from '@/components/ai/AiIcon'",
    "import { Sparkles } from 'some-other-lib'",
    "import * as L from 'lucide-react'\nconst I = L.Bot",
    "const L = {}\nconst I = L.Sparkles",
  ],
  invalid: [
    "import { Sparkles } from 'lucide-react'",
    "import { Sparkles as S } from 'lucide-react'",
    "import { SparklesIcon } from 'lucide-react'",
    "import { LucideSparkles } from 'lucide-react'",
    "import { WandSparkles } from 'lucide-react'",
    "import Sparkles from 'lucide-react/dist/esm/icons/sparkles'",
    "export { Sparkles } from 'lucide-react'",
    "import { Bot, Sparkles } from 'lucide-react'",
    "import { Sparkle } from 'lucide-react'",
    "import { SparkleIcon } from 'lucide-react'",
    "import * as L from 'lucide-react'\nconst I = L.Sparkles",
    "import * as L from 'lucide-react'\nconst I = L.Sparkle",
    "import * as L from 'lucide-react'\nconst x = <L.Sparkles className=\"a\" />",
  ].map((code) => ({ code, errors: [{ messageId: 'direct' }] })),
})

tester.run('no-raw-ai-hue', noRawAiHue, {
  valid: [
    "const key = 'violet'",
    "const label = 'indigo 팀'",
    '<span className="text-ai-accent bg-ai-accent-subtle" />',
    "'bg-sky-100 text-sky-700'",
  ],
  invalid: [
    '<span className="text-indigo-700" />',
    "cn('px-2', 'bg-violet-100')",
    '`border ${x} border-fuchsia-500`',
    "'dark:text-purple-300'",
    "'bg-violet-500/10'",
    "'var(--color-indigo-500)'",
    "'bg-indigo-50'",
    "'text-purple-950'",
  ].map((code) => ({ code, errors: [{ messageId: 'rawHue' }] })),
})
