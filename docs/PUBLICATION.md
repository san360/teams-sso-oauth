# Publication hygiene

Publish only source, placeholder templates, sample icons, dependency manifests, tests and public documentation. `.gitignore` excludes environment files, deployment state, generated Teams IDs/manifests/packages, local settings, logs, certificate/key files and editor/tool artifacts. Ignore rules do not untrack already committed files: review the index as well.

## Before committing or pushing

```powershell
git status --short
git diff --cached --stat
node scripts\check-publication.js --staged
```

The staged check reads the **exact index blobs**, not just the working directory. Before a public push, also run:

```powershell
node scripts\check-publication.js --history
```

The history check examines **all commits reachable from HEAD**, their author/committer identities and messages, every tracked path and every unique blob. Push only the audited branch, not tags, extra branches or `--mirror`.

The checker rejects non-allowlisted GUIDs, email addresses, recognizable JWT/private-key/provider-token patterns, deployment hostnames, tenant domains, common internal/local references, unexpected binary files and generated/private paths. PNGs are checked for a strict structural chunk allowlist without text/EXIF metadata. The GUID allowlist consists only of documented Microsoft first-party client/resource/scope/provider constants. Author metadata is limited to the public `san360` GitHub noreply identity and the required public Copilot co-author trailer.

Also run an independent local secret scanner such as Gitleaks against staged/publication content and all intended history:

```powershell
gitleaks git --pre-commit --staged --redact --ignore-gitleaks-allow
gitleaks git --log-opts='HEAD' --redact --ignore-gitleaks-allow
```

`.gitleaks.toml` extends the default rules with one exact-value exception for Microsoft's public Bot Service Token Store encoding. It is not a credential and is documented in the configuration reference. Do not add deployment values or credentials to this exception.

Review the complete prospective commit manually, including dependency URLs, scripts, docs, binary assets and commit metadata. Do not upload source or scan reports to third-party analysis services.

## If existing history contains private content

Deleting it in the latest commit is insufficient. Preserve the private checkout/history. Export only the reviewed, sanitized files into a separate new Git repository and create a fresh root commit using non-personal public noreply metadata. Audit that repository before pushing. Never copy `.git`, `.env`, generated packages, deployment state or private test artifacts into the publication tree. Do not rewrite or force-push an existing remote to conceal a leak.

Use a GitHub-provided noreply author identity rather than a personal address. Do not include private paths, internal links, incident references, account names, tenant IDs or access tokens in commit messages, repository descriptions, issues, PRs or release assets.

## Scope and limitations

These are **publication hygiene checks**, not proof that no conceivable PII or secret exists. Pattern checks cannot reliably identify arbitrary personal names, proprietary context, novel credential formats or secrets embedded in images. Manually review the source and verify the sample icons visually. Do not publish arbitrary archives or generated deployment files.

After publication, confirm repository visibility, branch/commit count, commit metadata, complete file inventory and downloaded file hashes against the audited local tree. Check that there are no unreviewed branches, tags or release assets. Remote secret scanning may provide additional protection but does not replace pre-upload checks; availability depends on GitHub settings and permissions.

Runtime privacy is separate: the demo defaults to intentionally disclosing the complete JWT and decoded personal claims in the authorized `whoami` card and fallback. The app also echoes user input, Teams retains conversation content, and dependency/service diagnostics may contain identity data. A sanitized source/history scan does not protect retained chat or make runtime data anonymous. Use isolated demo accounts; set `WHOAMI_TOKEN_DISPLAY=masked` or remove the diagnostic route before production. Never add actual token/claim captures, screenshots or logs to public artifacts.
