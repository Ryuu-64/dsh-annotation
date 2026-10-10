# @ryuu-64/dsh-annotation

**English** | [简体中文](./README.zh-CN.md)

Select text in a DSH assistant reply or workspace file, add an optional note, and send the annotation with your next message. The assistant can answer each annotation by number, and the numbered reply chips reveal the quoted text on hover.

This is an independently maintained distribution of [`omdsh-dev/dsh-annotation`](https://github.com/omdsh-dev/dsh-annotation). Version 1.6.0 uses upstream 1.4.11 as its source baseline and keeps the `@ryuu-64/dsh-annotation` package identity.

## What it supports

- Assistant-message annotations with optional notes
- Numbered highlights and reply chips
- Pending annotations that survive session switches and refreshes
- Plain-text, Markdown, and code annotations in workspace file previews
- Chinese, English, and Russian UI text
- DSH releases through 0.2.0-rc.2, as verified by the upstream 1.4.11 release

PDF files, images, and HTML inside iframes are not covered.

## Install in DSH Desktop

The upstream package and this package are alternatives. Remove the upstream package before installing this one:

```powershell
dsh plugin --profile desktop remove @changfenhuang/dsh-annotation
dsh plugin --profile desktop add git+https://github.com/Ryuu-64/dsh-annotation.git
```

Restart DSH Desktop after installation. Refreshing the page alone does not reload the Desktop plugin list.

Do not enable both packages at the same time. They intentionally use the same DSH plugin id, `dsh-annotation`, because this package is a drop-in replacement rather than a second annotation system.

## Check the installation

```powershell
dsh --profile desktop --dump-config | rg "id: dsh-annotation"
```

The command should show exactly one `dsh-annotation` entry. In DSH Desktop, select text in an assistant reply, save an annotation, send a message, and confirm that the numbered reply chip remains usable when hovered.

## Feedback

- Issues: <https://github.com/Ryuu-64/dsh-annotation/issues>
- QQ group: `1129212995`

Please report problems with this distribution here rather than in the upstream repository.

## License and upstream credit

MIT. Upstream copyright belongs to omdsh-dev. Fork-specific changes belong to Ryuu-64. See [`LICENSE`](./LICENSE) and [`NOTICE.md`](./NOTICE.md).
