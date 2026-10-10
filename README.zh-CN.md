# @ryuu-64/dsh-annotation

[English](./README.md) | **简体中文**

在 DSH 的助手回复或工作区文件里选中文字，添加可选批注，再随下一条消息一起发送。助手可以按编号逐条回应；把鼠标移到回复里的编号标签上，可以查看当时引用的原文。

这是 [`omdsh-dev/dsh-annotation`](https://github.com/omdsh-dev/dsh-annotation) 的独立维护版本。1.6.0 以上游 1.4.11 为源码基线，并保留 `@ryuu-64/dsh-annotation` 包名。

## 支持的功能

- 给助手消息添加批注，批注说明可以留空
- 编号高亮和回复标签
- 未发送批注在切换会话或刷新后继续保留
- 在工作区的纯文本、Markdown 和代码文件预览里批注
- 中文、英文和俄语界面
- 上游 1.4.11 已验收至 DSH 0.2.0-rc.2

暂不支持 PDF、图片和 iframe 内的 HTML。

## 安装到 DSH Desktop

上游包和本包是二选一的替代关系。安装本包前先移除上游包：

```powershell
dsh plugin --profile desktop remove @changfenhuang/dsh-annotation
dsh plugin --profile desktop add git+https://github.com/Ryuu-64/dsh-annotation.git
```

安装后重启 DSH Desktop。只刷新页面不会重新读取 Desktop 的插件列表。

不要同时启用两个包。它们有意使用同一个 DSH 插件 ID `dsh-annotation`，因为本包是上游包的替代版本，不是第二套批注系统。

## 确认是否安装成功

```powershell
dsh --profile desktop --dump-config | rg "id: dsh-annotation"
```

命令应当只显示一个 `dsh-annotation`。进入 DSH Desktop 后，在助手回复里选中文字、保存批注并发送消息，再确认回复里的编号标签可以正常悬停查看。

## 反馈

- 问题反馈：<https://github.com/Ryuu-64/dsh-annotation/issues>
- QQ 群：`1129212995`

这个版本的问题请反馈到本仓库，不要提交给上游仓库。

## 许可与上游署名

MIT。上游版权归 omdsh-dev，fork 的独立改动归 Ryuu-64。详见 [`LICENSE`](./LICENSE) 和 [`NOTICE.md`](./NOTICE.md)。
