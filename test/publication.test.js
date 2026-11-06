import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const checker = fileURLToPath(new URL('../scripts/check-publication.js', import.meta.url))
function fixture (run) {
  const cwd = mkdtempSync(join(tmpdir(), 'sso-publication-test-'))
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  const check = mode => spawnSync(process.execPath, [checker, mode], { cwd, encoding: 'utf8' })
  try {
    git('init', '-q')
    git('config', 'user.name', 'san360')
    git('config', 'user.email', '6613457+san360@users.noreply.github.com')
    run({ cwd, git, check })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

test('publication scans the index, not unstaged working changes', () => fixture(({ cwd, git, check }) => {
  writeFileSync(join(cwd, 'README.md'), 'Public sample\n')
  git('add', 'README.md')
  writeFileSync(join(cwd, 'README.md'), randomUUID())
  assert.equal(check('--staged').status, 0)
  git('add', 'README.md')
  const result = check('--staged')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /non-platform GUID/)
}))

test('publication rejects generated artifacts and unapproved email metadata', () => fixture(({ cwd, git, check }) => {
  writeFileSync(join(cwd, 'manifest.json'), '{}')
  git('add', 'manifest.json')
  assert.match(check('--staged').stderr, /generated\/private path/)
  git('rm', '--cached', 'manifest.json')
  writeFileSync(join(cwd, 'README.md'), 'Public sample\n')
  git('add', 'README.md')
  git('-c', `user.email=${['private', 'example.invalid'].join('@')}`, 'commit', '-qm', 'Public sample')
  assert.match(check('--history').stderr, /non-public author\/committer metadata/)
}))

test('history scan catches a removed identifier in earlier commits', () => fixture(({ cwd, git, check }) => {
  writeFileSync(join(cwd, 'README.md'), randomUUID())
  git('add', 'README.md')
  git('commit', '-qm', 'Initial sample')
  writeFileSync(join(cwd, 'README.md'), 'Public sample\n')
  git('add', 'README.md')
  git('commit', '-qm', 'Replace sample')
  assert.equal(check('--staged').status, 0)
  assert.match(check('--history').stderr, /non-platform GUID/)
}))

test('sample PNG is accepted but appended data is rejected', () => fixture(({ cwd, git, check }) => {
  const icon = join(cwd, 'color.png')
  copyFileSync(fileURLToPath(new URL('../appPackage/color.png', import.meta.url)), icon)
  git('add', 'color.png')
  assert.equal(check('--staged').status, 0)
  writeFileSync(icon, 'extra', { flag: 'a' })
  git('add', 'color.png')
  assert.match(check('--staged').stderr, /trailing content/)
}))
