// Tests for the standards list in hooks/register.ts. Run: node --test scripts/test/standards.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// register.ts drops a missing standards file silently, so a missing file
// must fail here instead.
test('every standards file listed in register.ts exists', () => {
  const source = readFileSync(join(ROOT, 'hooks', 'register.ts'), 'utf8')
  const list = source.match(/const STANDARDS = \[([^\]]*)\]/)
  assert.ok(list, 'STANDARDS list not found in hooks/register.ts')
  const names = [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  assert.ok(names.length > 0, 'STANDARDS list is empty')
  for (const name of names) {
    assert.ok(existsSync(join(ROOT, 'standards', name)), `standards/${name} is missing`)
  }
})
