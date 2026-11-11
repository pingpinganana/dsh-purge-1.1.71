# v1.1.71 兼容热修（0.2.1+ 宿主）

本仓库是 `ZXEB/dsh-purge` v1.1.71 镜像的 fork，额外包含了针对 **DeepSeek Harness 0.2.1+** 的兼容性修复。
热修只解决「装不上 / 每轮报错 / 无法重启」这三类故障，**没有增加任何新功能或新载荷**，
也不改动模型、模型权重与 `reasoningEffort` 配置。

> 面向使用者的摘要（症状、根因、修好后的表现、生效顺序）写在 [`README.md` 首页的「本 fork 修了什么」章节](../README.md#hotfix)，英文版见 [`README.en.md`](../README.en.md#hotfix)。本文是完整的改动清单、验证与回滚说明。

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

## 三、预设（模式）改动

宿主 0.2.1 起，子会话的人格与工具面**不能再由 `dsh-tool-subagent` 行的 `toolFilter` / `persona` 决定**：
`@deepseek-ai/dsh-tool-subagent` 对这两个字段直接抛 `is no longer supported; configure persona
and tool plugins in an Agent Preset and select it with agentPreset (spawn only)`，**整个预设被标
broken**（下拉里仍显示，选中后派活全废）。1.1.71 的红队预设正是这个写法，所以它在 0.2.1+ 上
一直是坏的 —— `$DSH_HOME/redteam/preset-declare.json` 会记成 `phase: "registered-broken"`。

| 改动 | 文件 |
|---|---|
| 委派行去掉 `toolFilter`，改写 `agentPreset: <id>-sub` + `allowedAgentPresets`（后者必须包含前者，否则宿主报 `agentPreset must be included in allowedAgentPresets`） | `presets/redteam/agent.cordis.yml`、`presets/unrestricted/agent.cordis.yml` |
| 新增两个配套子预设：只挂执行工具，**一个委派工具都不挂**（`subagent` / `subagent_fork` / `workflow` / `ralph` 全无），也不挂 plan mode 与 goal（子会话没人批计划） | `presets/redteam-sub/`、`presets/unrestricted-sub/` |
| 新增官方 `unrestricted` 预设（移植自社区仓库，按 0.2.1+ 机制改造，`order: 20`） | `presets/unrestricted/` |
| 插件改为多预设：`bundledPresetIds()` 扫 `presets/`，`installPreset({ id })` 逐个落盘，`registerAll()` 全部注册并逐个回查 `broken`，状态写进 `preset-declare.json` 的 `presets` 数组 | `lib/redteam/index.js` |
| 自愈：已存在的用户预设里的 `toolFilter` 块就地换成子预设写法（按缩进扫描，块后即使没有空行也不会误删下一行） | `lib/redteam/index.js` 的 `repairSubagentToolFilter()` |
| 自愈：删掉已废弃的 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 行 —— 0.2.2 把 `list_agents` / `send_message` / `interrupt_agent` 并进了 `@deepseek-ai/dsh-tool-subagent-control` 主包，该子路径已不在 `exports` 里，单挂会 `never started` 并拖垮整个预设 | `presets/redteam`、`presets/unrestricted`、`lib/redteam/index.js` 的 `dropToolRow()` |
| 只读校验：四份预设是否可解析、`toolFilter` 是否清零、`agentPreset` 是否已声明、子预设是否真的没有委派工具 | `scripts/verify-presets.mjs` |

四个预设及定位：

| 模式 | id | order | 定位 |
|---|---|---|---|
| 红队模式 | `redteam` | 10 | 主会话指挥端：计划 / 派活 / 对账，自己不动手 |
| 红队模式 · 子任务 | `redteam-sub` | 11 | 子会话执行端：角色职责由派活 prompt 的 `redteamRole:` 注入 |
| 无限制模式 | `unrestricted` | 20 | 主会话：官方骨架，操作者意图优先 |
| 无限制模式 · 子任务 | `unrestricted-sub` | 21 | 子会话执行档位 |

锚点门（`anchor-gate.mjs` + bootstrap 限流）只给红队指挥端装，其它预设不再注入这一层。

## 四、仓库自引用改动（重要）

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

## 五、验证

只读、不改宿主。在本仓库根目录执行：

```bash
# 静态校验（不需要宿主）
node --check lib/core.js
node --check lib/identity.js
node --check lib/redteam/index.js
node scripts/verify-hotfix.mjs
node scripts/verify-presets.mjs

# 连带宿主匹配校验（把路径换成自己的）
node scripts/verify-hotfix.mjs --host "<DSH安装目录>/resources/app/dsh/node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js"
```

`verify-hotfix.mjs` 会加载真实的 `ALL_PATCHES`，检查 #40 新增条目存在、三个文件无字面 `{{cwd}}`、插值白名单不含 `cwd`；给了 `--host` 时还会模拟替换并检查 marker、`requiredContexts` 保留情况，以及把替换后的宿主 JS 写到系统临时目录供 `node --check`。宿主升级后可复跑，用来判断 #40 是否还匹配。

YAML 校验：

```bash
python -c "import yaml,io; [yaml.compose(io.open(p,encoding='utf-8').read()) for p in ['cordis.patch.yml','presets/redteam/agent.cordis.yml']]; print('YAML OK')"
```

## 六、安装 / 生效顺序

插件由宿主**启动时加载进内存**，热修改的是插件源码，不是已运行的进程。

1. 从托盘**完全退出** DeepSeek Harness（关窗口不算；Windows 需确认任务管理器里没有残留进程）。
2. 用本仓库 tarball 安装，或把本目录整夹放到 `$DSH_HOME/plugins/dsh-purge` 后 `pnpm install`：

   ```bash
   dsh plugin --profile desktop add https://github.com/pingpinganana/dsh-purge-1.1.71/archive/refs/heads/master.tar.gz
   ```

3. 重新打开客户端 → 清洗页点「应用」→ 自动重启 → **新开一轮对话**（旧会话沿用旧上下文）。

## 七、回滚

- 只想回到上游 1.1.71：用 `ZXEB/dsh-purge` 的 tarball 重装，或直接还原下表 4 个文件的原始内容（本机留存 `.bak-20261111` 备份）。
- 只想回到官方宿主：`dsh-purge --revert`，再按需卸载。
- 注意：**从上游仓库点「检查更新」、或重装任意非本仓库的 tarball，都会覆盖这些改动。**

## 八、边界

本热修属于兼容性 bugfix，不包含 POC/EXP 知识库、攻击载荷或任何绕过能力增强。项目原有的授权与合规声明继续适用：仅限本机与有书面授权的靶场使用。
