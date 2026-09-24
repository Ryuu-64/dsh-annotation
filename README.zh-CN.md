# @ryuu-64/dsh-annotation

<!-- README-I18N:START -->

[English](./README.md) | **简体中文**

<!-- README-I18N:END -->

修复 DSH 批注插件「悬浮面板一闪就没」的问题。

选中助手回复里的文字 → 加批注 → 回车，模型会按编号逐条回应。把鼠标移到这些批注上
本该显示内容——上游插件里这块面板**只闪一下就消失**。这个 fork 修的就是它。

- 基于上游 [`@changfenhuang/dsh-annotation`](https://github.com/omdsh-dev/dsh-annotation) **1.4.10**（MIT）
- 问题反馈：https://github.com/Ryuu-64/dsh-annotation/issues
- 与上游无关，**请勿向上游反馈本 fork 的改动**

## 环境要求

- DSH Desktop，内核 **0.1.5-rc.2**（本 fork 的验证环境）

## 侧边栏文件批注

在工作区文件预览里选中文本、Markdown 或代码正文，沿用同一套批注 → 保存 → 回车流程即可。
发给模型的引用会带上文件路径；同一段文字出自不同文件时分别独立保存。刷新后重新打开该
文件，标记会恢复。

PDF、图片，以及 iframe 内的 HTML 暂不支持。

## 安装

执行下面两条命令，然后**重启 DSH Desktop**：

```powershell
git clone https://github.com/Ryuu-64/dsh-annotation.git
dsh plugin add .\dsh-annotation
```

**要让面板不再消失，必须顶掉上游插件**——如果还装着上游，先移除它：

```powershell
dsh plugin remove @changfenhuang/dsh-annotation
```

> **为什么要重启**：DSH 只在启动时读取插件列表，刷新页面不够。

## 确认是否生效

把鼠标移到**已经发出去的消息**上的批注——面板应该停住不消失。悬停时滚一下滚轮试试：
修复前只要一滚动，面板就没了。

如果仍然消失，请[提个 issue](https://github.com/Ryuu-64/dsh-annotation/issues)，
说明你的 DSH 版本和当时的操作。

## 卸载

```powershell
dsh plugin remove @ryuu-64/dsh-annotation
dsh plugin add @changfenhuang/dsh-annotation
```

## 升级 DSH 前请注意

将来某个 DSH 内核版本（**0.1.6-alpha.2 或更新**）会移除本插件依赖的一个接口，届时
批注会**不再随消息发送出去**——而且是**静默的，没有任何报错**。内容不会丢，但你会发现
批注文字没跟着发出去。

这一点**尚未修复**，记录在 [#10](https://github.com/Ryuu-64/dsh-annotation/issues/10)。
除此之外升级 DSH 是安全的。

## 许可

MIT。上游版权归 omdsh-dev，fork 改动归 Ryuu-64。见 [`LICENSE`](./LICENSE) 与 [`NOTICE.md`](./NOTICE.md)。
