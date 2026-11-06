import { execFileSync } from 'node:child_process'

const mode = process.argv[2]
if (!['--staged', '--history'].includes(mode)) {
  throw new Error('Usage: node scripts/check-publication.js --staged|--history')
}

const git = (...args) => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 })
const strings = buffer => buffer.toString('utf8').split('\0').filter(Boolean)

// Public Microsoft platform constants only; never add a deployment ID here.
const platformIds = new Set([
  '1fec8e78-bce4-4aaf-ab1b-5451cc387264',
  '5e3ce6c0-2b1f-4285-8d4b-75ee78787346',
  '4765445b-32c6-49b0-83e6-1d93765276ca',
  '0ec893e0-5785-4de6-99da-4ed124e5296c',
  'd3590ed6-52b3-4102-aeff-aad2292ab01c',
  'bc59ab01-8403-45c6-8796-ac3ef710b3e3',
  '27922004-5251-4030-b22d-91ecd9a37ea4',
  '3068386c-7a16-4f6a-a664-043b6b232816',
  '00000003-0000-0000-c000-000000000000',
  '37f7f235-527c-4136-accd-4a02d197296e',
  '14dad69e-099b-42c9-810b-d002981feec1',
  '7427e0e9-2fba-42fe-b0c0-848c9e6a8182',
  'c00b44ab-5e16-c44c-af26-2fd5bc55eb18'
])
const publicEmails = new Set([
  '6613457+san360@users.noreply.github.com',
  '223556219+copilot@users.noreply.github.com'
])
const failures = []
function flag (label, rule) {
  failures.push(`${label}: ${rule}`)
}

function scanText (label, text) {
  for (const id of text.matchAll(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi)) {
    if (!platformIds.has(id[0].toLowerCase())) flag(label, 'non-platform GUID')
  }
  for (const email of text.matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) {
    if (!publicEmails.has(email[0].toLowerCase())) flag(label, 'non-public email')
  }
  const rules = [
    ['JWT', /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/],
    ['provider credential', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9]{24,})/],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['tenant domain', /[\w-]+\.onmicrosoft\.com\b/i],
    ['deployment hostname', /https:\/\/(?!<|\{|\$)[a-z0-9-]+\.(?:scm\.)?(?:azurewebsites\.net|azurecontainerapps\.io)/i],
    ['private network URL', /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|[\w.-]+\.(?:corp|internal|local))(?=[:/)\s]|$)/i],
    ['internal link', /https?:\/\/[\w.-]*(?:sharepoint\.com|visualstudio\.com|dev\.azure\.com|microsoft\.sharepoint-df\.com)(?=[:/)\s]|$)/i],
    ['absolute local path', /(?:[a-z]:[\\/](?:Users|dev|repos|temp)[\\/]|\/(?:Users|home)\/[a-z0-9_.-]+\/)/i],
    ['private incident reference', /\b(?:REQ|INC|ICM)-?\d{5,}\b/i]
  ]
  for (const [rule, pattern] of rules) {
    if (pattern.test(text)) flag(label, rule)
  }
}

function scanPng (label, data) {
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    flag(label, 'invalid PNG signature')
    return
  }
  let offset = 8
  let ended = false
  let header = false
  let pixels = false
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const chunk = data.toString('ascii', offset + 4, offset + 8)
    if (!['IHDR', 'IDAT', 'IEND'].includes(chunk)) flag(label, 'PNG metadata or unexpected chunk')
    if (offset + length + 12 > data.length) {
      flag(label, 'invalid PNG chunk length')
      return
    }
    if (chunk === 'IHDR') header = length === 13 && offset === 8
    if (chunk === 'IDAT') pixels = true
    offset += length + 12
    if (chunk === 'IEND') {
      ended = length === 0 && offset === data.length
      break
    }
  }
  if (!header || !pixels || !ended) flag(label, 'invalid PNG structure or trailing content')
}

const seen = new Set()
let pathsChecked = 0
function scanEntry (path, hash, fileMode) {
  pathsChecked++
  scanText('tracked path', path)
  if (/(^|\/)(?:node_modules|build|out|logs|\.azure|\.azd|\.vscode)(\/|$)|(^|\/)\.env(?!\.example$)|\.deploy-state|teams-app-id\.txt$|(^|\/)(?:manifest|appsettings[^/]*|local\.settings)\.json$|\.(?:zip|log|pem|key|pfx|p12|cer|crt|bak|tmp)$/i.test(path)) {
    flag(path, 'generated/private path')
  }
  if (!['100644', '100755'].includes(fileMode)) flag(path, 'unexpected file mode (link/submodule)')
  if (seen.has(hash)) return
  seen.add(hash)
  const data = git('cat-file', 'blob', hash)
  if (path.endsWith('.png')) {
    scanPng(path, data)
  } else if (data.includes(0) || !/\.(?:js|json|md|ps1|toml)$|(^|\/)\.(?:gitignore|env\.example)$/.test(path)) {
    flag(path, 'unexpected binary or file type')
  } else {
    scanText(path, data.toString('utf8'))
  }
}

if (mode === '--staged') {
  for (const entry of strings(git('ls-files', '--stage', '-z'))) {
    const [meta, path] = entry.split('\t')
    const [fileMode, hash, stage] = meta.split(' ')
    if (stage !== '0') flag(path, 'unresolved index entry')
    scanEntry(path, hash, fileMode)
  }
} else {
  const commits = git('rev-list', 'HEAD').toString('utf8').trim().split('\n')
  for (const commit of commits) {
    const metadata = git('show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%B', commit).toString('utf8')
    scanText(`commit ${commit.slice(0, 8)}`, metadata)
    const [author, authorEmail, committer, committerEmail] = metadata.split('\n')
    if (author !== 'san360' || committer !== 'san360' ||
        authorEmail !== '6613457+san360@users.noreply.github.com' ||
        committerEmail !== '6613457+san360@users.noreply.github.com') {
      flag(`commit ${commit.slice(0, 8)}`, 'non-public author/committer metadata')
    }
    for (const entry of strings(git('ls-tree', '-r', '-z', commit))) {
      const [meta, path] = entry.split('\t')
      const [fileMode, type, hash] = meta.split(' ')
      if (type !== 'blob') flag(path, 'non-blob tree entry')
      else scanEntry(path, hash, fileMode)
    }
  }
  console.log(`History commits checked: ${commits.length}`)
}

if (failures.length) {
  console.error([...new Set(failures)].join('\n'))
  process.exitCode = 1
} else {
  console.log(`Publication hygiene PASS: ${pathsChecked} paths, ${seen.size} unique blobs (${mode}).`)
}
