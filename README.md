# LLM-CatchUp

一个由 Claude Code 驱动的 AI 新闻聚合器。每天早上自动抓取近 20 个高信号源（官方博客、研究页、精选 newsletter、Twitter/X 账号），用 LLM 做摘要、分类、重要度打分，生成中文日报 / 周报 / 月报。

## 工作方式

系统分两半：

- **抓取端**：GitHub Actions 每天 07:37（Asia/Shanghai）跑一次 `scripts/fetch-sources.js`，按 `config.yaml` 里声明的源逐个抓取，过滤到近 30 小时窗口，写入 `data/fetch-cache/YYYY-MM-DD.json`。
- **分析端**：Claude Code Cloud Scheduled Triggers 每天 / 每周 / 每月跑一次，读取上面那个 snapshot（不再自己抓取），做分析、生成 `reports/` 下的 markdown 报告，commit + push。

完整架构、运行规则和惯例见 [`CLAUDE.md`](./CLAUDE.md)。

## 报告示例

- 日报：[`reports/daily/`](./reports/daily/)
- 周报：[`reports/weekly/`](./reports/weekly/)
- 月报：[`reports/monthly/`](./reports/monthly/)

## 本地运行抓取端

```bash
nvm use
pnpm install
node scripts/fetch-sources.js
```

## 参考与致谢

本项目从下面几个项目借鉴了思路、数据或机制：

- **[ginobefun/BestBlogs](https://github.com/ginobefun/BestBlogs)** — AI 领域的精选订阅源合集（400+ RSS / OPML）。本项目的 Twitter/X 账号 UUID 直接从他们的 [`BestBlogs_RSS_Twitters.opml`](https://github.com/ginobefun/BestBlogs/blob/main/BestBlogs_RSS_Twitters.opml) 查得。
- **[obra/superpowers](https://github.com/obra/superpowers)** — Claude Code 的 skills + subagents 框架。本项目 `.claude/skills/` 与 `.claude/agents/` 的结构和最小集成方式参考了该插件的社区适配惯例（`payloadcms/payload` 和 `devallibus/shiplog` 的用法尤其有启发）。
- **[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)** — 官方插件市场，superpowers 经此发布。
- **[jesses 的 superpowers 博客](https://blog.fsck.com/2025/10/09/superpowers/)** — superpowers 作者关于"让 skills 自动触发、不要在 CLAUDE.md 里重复注入"的使用指引。

外部运行时依赖（见 [`CLAUDE.md`](./CLAUDE.md) 的 "External dependencies" 段落）：

- **`api.xgo.ing`** — Twitter→RSS 镜像，用于所有 `*(Twitter)` 源。
- **`r.jina.ai`** — Reader 代理，用于绕过 Substack 在 GH Actions IP 段上的 Cloudflare 拦截（见 `scripts/routes/berkeley-rdi.js`）。

## License

私人项目，暂无正式 license。代码仅供学习参考。
