# @ryuu-64/dsh-annotation

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh-CN.md)

<!-- README-I18N:END -->

A **fork** of the DSH Web selection-annotation plugin, fixing "the annotation tooltip
flashes once on hover and then disappears immediately".

Based on upstream [`@changfenhuang/dsh-annotation`](https://github.com/omdsh-dev/dsh-annotation)
**1.4.10** (MIT). This fork changes only the browser-side **hover-tip subsystem** of
`client.js`; everything else behaves exactly like upstream, so aligning with upstream fixes
later stays cheap.

- Issue tracker: https://github.com/Ryuu-64/dsh-annotation/issues
- Not affiliated with upstream — **please do not report this fork's changes there**
- What changed and how it relates to upstream: see [`NOTICE.md`](./NOTICE.md) and [`CHANGELOG.md`](./CHANGELOG.md)
- Upstream original docs: [`README.fork-upstream.md`](./README.fork-upstream.md) / [`README.fork-upstream.zh-CN.md`](./README.fork-upstream.zh-CN.md)

## Install (local link, recommended)

The browser half is a hand-written CJS bundle with **no build step**, so source edits take
effect immediately:

```powershell
git clone https://github.com/Ryuu-64/dsh-annotation.git
cd dsh-annotation
node scripts/deploy-profile.mjs      # wire into the desktop profile (idempotent)
npm test                             # check the wiring (test/deployment.test.mjs)
```

`deploy-profile` does three things: points the profile dependency at `link:<this repo>`,
replaces the upstream package name with this fork's name in `dsh.profile.bundles`, and runs
`pnpm install`.

> ⚠ **Changing dependencies or the bundle list requires a full DSH Desktop restart** — the
> bundle list is resolved once at host start-up, so refreshing the page will not bring the
> new plugin online. Editing `client.js` only needs a page refresh.

Roll back to upstream: `node scripts/deploy-profile.mjs --remove`

## Verification

```powershell
npm install     # jsdom is the only devDependency
npm test        # one command runs every test (currently 44)
```

Convention: **actions live in `scripts/`, checks live in `test/`**. `scripts/` holds only
scripts that change your system (`deploy-profile` edits the profile, `install-local` installs
dependencies); every check and audit is a test under `test/`, with assertions that fail loudly.

- Checks that need a local DSH profile (is the wiring correct?) are **skipped** when this
  machine has no such profile — they never pretend to pass;
- Checks that need the upstream baseline code fetch it from npm themselves (and skip if that
  is unavailable); they exist to confirm these tests **actually target the defects** rather
  than reassuring ourselves.

## Known risks

- **Kernel 0.1.6-alpha.2+ silently breaks "send annotation"**: the kernel removed
  `sessions.list.current`, which this fork (and upstream 1.4.10 / 1.4.11-preview.1) reads in
  7 places; `attachAndSend()` / `submitAttached()` then **return silently**. The verified host
  today is 0.1.5-rc.2, so it is unaffected. See [#10](https://github.com/Ryuu-64/dsh-annotation/issues/10).
- This fork is not published to npm; install it via `link:` or a self-built tarball.

## License

MIT. Upstream copyright belongs to omdsh-dev; fork changes belong to Ryuu-64.
See [`LICENSE`](./LICENSE) and [`NOTICE.md`](./NOTICE.md).
