# v1.1.71 兼容热修（0.2.1+ 宿主）

本仓库是 `ZXEB/dsh-purge` v1.1.71 镜像的 fork，额外包含了针对 **DeepSeek Harness 0.2.1+** 的兼容性修复。
热修只解决「装不上 / 每轮报错 / 无法重启」这三类故障，**没有增加任何新功能或新载荷**，
也不改动模型、模型权重与 `reasoningEffort` 配置。

## 一、症状

| 现象 | 来源 |
|---|---|
| 每轮对话失败：`unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model` | 宿主 0.2.1 起只注册 `provider` / `model`，且对未知模板变量硬失败 |
| 清洗页应用后：`dsh-purge失败: 清洗没有写进全部宿主，已取消重启` | 宿主 assemble 段新增 `requiredContexts` 与带 `tools` 的 early return，补丁 #40 的 6 条 pattern 全部失配，inject marker 写不进去，`ensureHostClean()` 拦下重启 |

上游 1.2.0 修了 `{{cwd}}`，1.2.1 修了重启闸门；这里是**在 1.1.71 上等价补齐**，不引入上游其它变动。

## 二、代码改动

| 文件 | 改动 |
|---|---|
| `cordis.patch.yml` | `personaSuffix` 去掉 `{{cwd}}`，改为静态文本 `the session workspace root` |
| `lib/identity.js` | `CWD_ONLY_SUFFIX` 等 5 处字面量去变量化；`DSH_INTERPOLATE_ALLOWED` 从 `cwd/model/provider` 收窄为 `model/provider`（否则旧变量会被当合法放过去）；注释同步 |
| `lib/core.js` | ① 3 处 `{{cwd}}` → 静态文本；② 新增 `COMPLETE_PROMPT_REQUIRED_CONTEXTS_INJECT`，作为补丁 #40 的 `replacements[0]`，精确匹配 0.2.1+ 官方 assemble 原文，保留 `tools` / `requiredContexts` 语义并写回 `[dsh-purge] complete prompt keeps inject + agent-instructions` marker；③ `ensureHostClean()` 对齐 1.2.1：只是 soft-skip / pattern 未命中时放行并带 `warnings`，真有 `failed` / `read_error` 或拿不到 apply 报告时仍然拦 |
| `presets/redteam/agent.cordis.yml` | 注释里关于 `{{cwd}}` 的说明同步更新 |

旧宿主的 6 条 pattern 全部保留在新条目之后，先命中者生效，因此**向下兼容 0.2.0-rc.2**。

## 三、仓库自引用改动（重要）

fork 之后 `package.json` 的 `repository / homepage / bugs / dsh.install` 已指向本仓库，但运行时代码与文档仍硬编码上游地址。如果不改，点一次「检查更新」就会从 `ZXEB/dsh-purge` 拉回**未修复**的 1.1.71，热修被覆盖。

| 文件 | 改动 |
|---|---|
| `lib/update.js` | `REPO` 常量改为 `pingpinganana/dsh-purge-1.1.71`（决定 codeload / raw / api 的更新源） |
| `client.js` | 两处 `welcome.repo` 链接改为本仓库 |
| `lib/redteam/ui.js` | `githubRepoOf()` 的默认返回值改为本仓库 |
| `.github/workflows/release.yml` | `jobs.release.if` 与日志链接改为本仓库；workflow 自带 `gh release view "$tag"` 幂等保护，tag 已存在时会直接跳过 |
| `README.md` / `README.zh-CN.md` / `README.en.md` | 所有安装 / clone / 更新命令与说明链接改为本仓库；顶部加热修提示；兼容性表增加 hotfix 行；**保留署名段对上游 `ZXEB/dsh-purge` 与原作者 `YuJunZhiXue/dsh-purge`（小杨）的署名** |

`package.json` 的 `version` 仍为 `1.1.71`，`release-notes.md` 首行仍为 `# 1.1.71`，避免触发版本比较与误判升级。
若不想让 push 触发自动发版，把 `release.yml` 第 17 行的 `if:` 改回 `false` 即可。

## 四、验证

只读、不改宿主。在本仓库根目录执行：

```bash
# 静态校验（不需要宿主）
node --check lib/core.js
node --check lib/identity.js
node scripts/verify-hotfix.mjs

# 连带宿主匹配校验（把路径换成自己的）
node scripts/verify-hotfix.mjs --host "<DSH安装目录>/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js"
```

`verify-hotfix.mjs` 会加载真实的 `ALL_PATCHES`，检查 #40 新增条目存在、三个文件无字面 `{{cwd}}`、插值白名单不含 `cwd`；给了 `--host` 时还会模拟替换并检查 marker、`requiredContexts` 保留情况，以及把替换后的宿主 JS 写到系统临时目录供 `node --check`。宿主升级后可复跑，用来判断 #40 是否还匹配。

YAML 校验：

```bash
python -c "import yaml,io; [yaml.compose(io.open(p,encoding='utf-8').read()) for p in ['cordis.patch.yml','presets/redteam/agent.cordis.yml']]; print('YAML OK')"
```

## 五、安装 / 生效顺序

插件由宿主**启动时加载进内存**，热修改的是插件源码，不是已运行的进程。

1. 从托盘**完全退出** DeepSeek Harness（关窗口不算；Windows 需确认任务管理器里没有残留进程）。
2. 用本仓库 tarball 安装，或把本目录整夹放到 `$DSH_HOME/plugins/dsh-purge` 后 `pnpm install`：

   ```bash
   dsh plugin --profile desktop add https://github.com/pingpinganana/dsh-purge-1.1.71/archive/refs/heads/master.tar.gz
   ```

3. 重新打开客户端 → 清洗页点「应用」→ 自动重启 → **新开一轮对话**（旧会话沿用旧上下文）。

## 六、回滚

- 只想回到上游 1.1.71：用 `ZXEB/dsh-purge` 的 tarball 重装，或直接还原下表 4 个文件的原始内容（本机留存 `.bak-20261111` 备份）。
- 只想回到官方宿主：`dsh-purge --revert`，再按需卸载。
- 注意：**从上游仓库点「检查更新」、或重装任意非本仓库的 tarball，都会覆盖这些改动。**

## 七、边界

本热修属于兼容性 bugfix，不包含 POC/EXP 知识库、攻击载荷或任何绕过能力增强。项目原有的授权与合规声明继续适用：仅限本机与有书面授权的靶场使用。
