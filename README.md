# LLM-CatchUp

一个由 Claude Code 驱动的 AI 新闻聚合器。每天早上自动抓取近 20 个高信号源（官方博客、研究页、精选 newsletter、Twitter/X 账号），用 LLM 做摘要、分类、重要度打分，生成中文日报 / 周报 / 月报。

## 工作方式

系统分两半：

- **抓取端**：GitHub Actions 每天 00:37（America/Los_Angeles）运行 `scripts/fetch-sources.js`。博客源按刚结束的太平洋日抓取；Twitter 源使用带 48 小时重叠的增量 Search，并以 `data/twitter-state.json` 保存账号水位和未消费队列。快照写入 `data/fetch-cache/YYYY-MM-DD.json`；03:17 的兜底任务只补抓缺失或失败来源。
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

- **[socialdata.tools](https://socialdata.tools)** — 付费 Twitter REST API。日常使用带 `-filter:replies` 的增量 Search 并完整翻页，空 Search 直接视为无新增；不再执行自动 timeline 审计。当前按返回的 tweet 计费，约 $0.0002/条。
- **[ginobefun/BestBlogs](https://github.com/ginobefun/BestBlogs)** — AI 领域的精选订阅源合集（400+ RSS / OPML），早期版本的 Twitter handle 列表从他们的 OPML 中查得。
- **[obra/superpowers](https://github.com/obra/superpowers)** — Claude Code 的 skills + subagents 框架。本项目 `.claude/skills/` 与 `.claude/agents/` 的结构和最小集成方式参考了该插件的社区适配惯例（`payloadcms/payload` 和 `devallibus/shiplog` 的用法尤其有启发）。
- **[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)** — 官方插件市场，superpowers 经此发布。
- **[jesses 的 superpowers 博客](https://blog.fsck.com/2025/10/09/superpowers/)** — superpowers 作者关于"让 skills 自动触发、不要在 CLAUDE.md 里重复注入"的使用指引。

外部运行时依赖（见 [`CLAUDE.md`](./CLAUDE.md) 的 "External dependencies" 段落）：

- **`api.socialdata.tools`** — 付费 Twitter REST API，所有 `*(Twitter)` 源走它。需一个 GH Actions secret：`SOCIALDATA_API_KEY`。路由文件硬编码稳定的 `handle` 和 `userId`；单个来源可配置 `twitter_fetch_mode: timeline` 作为人工应急开关。按返回的 tweet 数量计费，用量累计在 fetch-cache 的 `api_usage`。**失效信号**：全部 Twitter 源集体 `error`，或某个来源超过 `max_silence_hours` 没有新内容。
- **`r.jina.ai`** — Reader 代理，只有 `scripts/routes/berkeley-rdi.js` 用；Substack 会屏蔽 Azure / GH Actions 出口 IP，jina 从它自己的源抓。**失效信号**：Berkeley RDI 连续 `error` 3 天后触发 `source-alert` issue。

分发渠道：repo 根目录的 `feed.xml`（RSS 2.0，由 `scripts/lib/build-rss.js` 在每次报告生成时重建，最近 30 条混合所有 cadence）。订阅地址：`https://raw.githubusercontent.com/Zerokei/LLM-CatchUp/main/feed.xml`。任意 RSS 阅读器可用；想要邮件形式的可以喂给 [Feedrabbit](https://feedrabbit.com) / Blogtrottr。

## License

私人项目，暂无正式 license。代码仅供学习参考。
