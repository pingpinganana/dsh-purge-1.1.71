> **本 fork 已包含 0.2.1+ 宿主兼容热修（v1.1.71-hotfix）。** 上游 1.1.71 在 DeepSeek Harness 0.2.1+ 上会因 `{{cwd}}` 已被移除而每轮报 `unknown prompt variable`，且补丁 #40 失配导致「清洗没有写进全部宿主，已取消重启」。本仓库已修好这两处，并把「检查更新」与安装源指向本仓库。
>
> 请**只用本仓库的 tarball 安装**（下方命令已改好），不要再指向 `ZXEB/dsh-purge`，否则会装回未修复的原版。改动清单、验证与回滚见 [`docs/HOTFIX-1.1.71.md`](docs/HOTFIX-1.1.71.md)。


<p align="center">
  <img src="docs/banner.svg" alt="dsh-purge" width="720">
</p>

<h1 align="center">⚔️ dsh-purge（中文文档）</h1>

> **中文完整文档已合并到 [`README.md`](README.md)。** 本文件保留仅为兼容旧链接与插件自更新时复制的文件清单。
>
> 请直接看 **[README.md](README.md)** —— 内含：
>
> - 环境要求（dsh 0.2.0-rc.2 / Node ≥ 18）
> - 四种安装方式：仓库 tarball、本地目录、手动改 profile、Release 压缩包
> - 安装后必做的三步（完全退出宿主 → 清洗 → 应用 → 自动重启 → 新开会话）
> - 安装验证清单、目录结构、运行时文件、配置项、CLI 与聊天命令
> - 更新 / 还原 / 卸载、12 条 FAQ、兼容性表、声明与署名
>
> 英文文档：[`README.en.md`](README.en.md)。原版 README（原作者版本，已归档）：[`docs/upstream/`](docs/upstream/)。

```powershell
# 最短路径：装到桌面宿主
dsh plugin --profile desktop add https://github.com/pingpinganana/dsh-purge-1.1.71/archive/refs/heads/master.tar.gz
```
