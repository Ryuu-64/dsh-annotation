# @ryuu-64/dsh-annotation

<!-- README-I18N:START -->

**English** | [简体中文](./README.zh-CN.md)

<!-- README-I18N:END -->

A fix for the DSH annotation plugin's disappearing tooltip.

Select text in an assistant reply → annotate it → press Enter, and the model answers each
annotation by number. Hovering those annotations is supposed to show their content — in the
upstream plugin the panel **flashes once and vanishes**. This fork fixes that.

- Built on upstream [`@changfenhuang/dsh-annotation`](https://github.com/omdsh-dev/dsh-annotation) **1.4.10** (MIT)
- Questions and bug reports: https://github.com/Ryuu-64/dsh-annotation/issues
- Not affiliated with upstream — please don't report this fork's changes there

## Requirements

- DSH Desktop with kernel **0.1.5-rc.2** (what this fork is verified against)

## Install

Run these two commands, then restart DSH Desktop:

```powershell
git clone https://github.com/Ryuu-64/dsh-annotation.git
dsh plugin add .\dsh-annotation
```

Replacing the upstream plugin is what makes the panel stop disappearing — remove it first if
it is still installed:

```powershell
dsh plugin remove @changfenhuang/dsh-annotation
```

> **Why the restart:** DSH only reads its plugin list at start-up. Refreshing the page is not
> enough.

## Check it worked

Hover an annotation on a message you have already sent — the panel should stay open. Scroll
the wheel while hovering; before the fix, any scroll made it disappear.

If it still disappears, please
[open an issue](https://github.com/Ryuu-64/dsh-annotation/issues) with your DSH version and
what you did.

## Uninstall

```powershell
dsh plugin remove @ryuu-64/dsh-annotation
dsh plugin add @changfenhuang/dsh-annotation
```

## Before you upgrade DSH

A future DSH kernel (**0.1.6-alpha.2 or newer**) removes something this plugin needs, and
annotations then stop being sent with your message — **silently, with no error**. Nothing is
lost, but you will not see the annotation text arrive.

This is not fixed yet; it is tracked in
[#10](https://github.com/Ryuu-64/dsh-annotation/issues/10). Upgrading DSH is safe otherwise.

## License

MIT. Upstream copyright belongs to omdsh-dev; fork changes belong to Ryuu-64.
See [`LICENSE`](./LICENSE) and [`NOTICE.md`](./NOTICE.md).
