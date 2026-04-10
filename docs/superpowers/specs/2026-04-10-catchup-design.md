# CatchUp - AI 资讯定期获取工具设计文档

## 概述

CatchUp 是一个基于 Claude Code Cloud Scheduled Trigger 的 AI 资讯聚合工具。它定期从多个订阅源抓取最新 AI 资讯，由 Claude 进行深度分析（摘要、分类、重要性评估、实践建议），生成结构化的 markdown 报告，通过 git 持久化所有数据和报告。

**核心特点：无 Python、无 SQLite、无额外依赖。** 整个系统由一个 git 仓库 + Cloud Scheduled Trigger 构成。

## 架构

```
Cloud Scheduled Trigger (定时执行)
    │
    ├── 1. Fresh clone 仓库
    ├── 2. 读取 config.yaml（数据源列表、分类、分析维度）
    ├── 3. 读取 data/history.json（已处理文章，用于去重）
    ├── 4. WebFetch 逐个抓取数据源
    ├── 5. Claude 分析（摘要/分类/评分/实践建议）
    ├── 6. 生成 markdown 报告
    ├── 7. 更新 data/history.json
    └── 8. Commit & push
```

每次触发都是独立的 session，通过 git 仓库实现跨次运行的状态持久化。

## 仓库结构

```
CatchUp/
├── config.yaml              # 数据源、分类、分析维度配置
├── data/
│   └── history.json         # 已处理文章记录（URL hash + 分析结果）
├── reports/
│   ├── daily/
│   │   └── 2026-04-10.md
│   ├── weekly/
│   │   └── 2026-W15.md
│   └── monthly/
│       └── 2026-04.md
└── .claude/
    └── settings.json        # Claude Code 项目级配置
```

## 数据源

### 支持的源类型

- **RSS/Atom feed** — Substack、官方博客等提供 RSS 的站点，通过 WebFetch 获取 XML 后由 Claude 解析结构化的 feed 数据，提取文章列表
- **网页抓取** — 无 RSS 的站点，通过 WebFetch 获取 HTML 后由 Claude 理解页面结构，提取文章标题、链接和内容

两种类型都使用 WebFetch 工具，区别在于 Claude 处理返回内容的方式不同。config.yaml 中的 `type` 字段告诉 Claude 用哪种策略解析。

### 初始数据源

| 名称 | 类型 | URL |
|------|------|-----|
| Berkeley RDI | rss | https://berkeleyrdi.substack.com/feed |
| The Batch (DeepLearning.AI) | web_scraper | https://www.deeplearning.ai/the-batch |
| OpenAI Blog | rss | https://openai.com/blog/rss.xml |
| Google AI Blog | rss | https://blog.google/technology/ai/rss/ |
| Anthropic Blog | rss | https://www.anthropic.com/blog/rss.xml |

### 可扩展性

数据源在 config.yaml 中配置，新增数据源只需添加一条配置：

```yaml
sources:
  - name: "Berkeley RDI"
    type: rss
    url: "https://berkeleyrdi.substack.com/feed"

  - name: "The Batch"
    type: web_scraper
    url: "https://www.deeplearning.ai/the-batch"

  - name: "OpenAI Blog"
    type: rss
    url: "https://openai.com/blog/rss.xml"
```

## 数据模型

### Article（抓取后）

- `title` — 文章标题
- `url` — 文章链接
- `source` — 数据源名称
- `published_at` — 发布时间
- `content` — 原文内容（纯文本）

### AnalyzedArticle（分析后）

核心字段（固定）：
- `summary` — 2-3 句摘要
- `category` — 分类
- `importance` — 1-5 重要性评分

扩展字段（通过 config 中的 analysis.dimensions 配置驱动）：
- `tags` — 关键词标签
- `practice_suggestions` — 实践建议（仅针对可上手体验的内容）
- 未来可通过配置新增更多维度

## 分类体系

6 个预定义分类（可在 config.yaml 中自定义）：

| 分类 | 覆盖范围 | 示例 |
|------|---------|------|
| 模型发布（Model Release） | 新模型、重大模型更新 | Claude 推出 Opus 4.6 |
| 研究（Research） | 论文、技术报告、实验性工作 | Attention 机制新论文 |
| 产品与功能（Products & Features） | 产品发布、功能更新、API 变更 | Claude Code 新增 hooks 功能 |
| 商业动态（Business） | 融资、收购、合作、人事变动 | Anthropic 完成 B 轮融资 |
| 政策与安全（Policy & Safety） | 监管、对齐、AI 安全 | 欧盟 AI Act 通过 |
| 教程与观点（Tutorial & Opinion） | 教学内容、博主观点、行业分析 | Karpathy 讲解 Transformer |

## 分析维度（可扩展）

分析维度由 config.yaml 驱动，每个维度包含：

```yaml
analysis:
  dimensions:
    - name: tags
      prompt: "提取 3-5 个关键词标签"
      type: list
      render: inline_tags

    - name: practice_suggestions
      prompt: "如果涉及可上手尝试的产品或功能，给出实践建议"
      condition: "category in ['模型发布', '产品与功能']"
      type: list
      render: callout_block
```

- `name` — 维度名称
- `prompt` — 指导 Claude 分析的提示词
- `type` — 数据类型（string / list）
- `condition` — 触发条件（可选，基于分类等字段）
- `render` — 渲染提示，指导报告中的展示方式

### 预定义 render 类型

- `inline_tags` — 行内标签：`tag1` `tag2` `tag3`
- `bullet_list` — 无序列表
- `callout_block` — 醒目区块（适合实践建议）
- `inline_field` — 简单的 key: value 一行

新增分析维度只需在 config.yaml 中添加一条，指定已有的 render 类型即可，无需修改报告模板。

## 报告生成

### 三级报告

**日报（Daily）**：
- 当天抓取到的所有文章，按重要性排序
- 每篇：标题、来源、摘要、分类、重要性评分、扩展维度信息
- 有实践建议的文章展示建议区块
- 底部附当日趋势简评

**周报（Weekly）**：
- 本周最重要的文章 Top 10
- 按分类聚合的本周概览
- 跨文章的关联分析和趋势总结
- 本周值得上手试试板块
- 值得深读的文章推荐

**月报（Monthly）**：
- 本月各分类的重大事件回顾
- 月度趋势分析（哪些方向在升温/降温）
- 各数据源的活跃度统计

### 输出路径

可在 config.yaml 中配置 `output_path`，默认为 `./reports`。由于 Cloud Trigger 每次 fresh clone 仓库，此路径为仓库内的相对路径。目录结构：

```
{output_path}/
  daily/
    2026-04-10.md
  weekly/
    2026-W15.md
  monthly/
    2026-04.md
```

## 去重与持久化

使用 `data/history.json` 替代传统数据库，通过 git 跟踪：

```json
{
  "articles": {
    "sha256_of_url": {
      "title": "...",
      "url": "...",
      "source": "Berkeley RDI",
      "published_at": "2026-04-10",
      "fetched_at": "2026-04-10T09:00:00Z",
      "summary": "...",
      "category": "研究",
      "importance": 4,
      "extras": {
        "tags": ["LLM", "alignment"],
        "practice_suggestions": ["..."]
      }
    }
  },
  "last_fetch": "2026-04-10T09:00:00Z"
}
```

去重逻辑：以文章 URL 的 SHA-256 hash 为 key，已存在的文章不重复抓取和分析。

### 数据清理

history.json 会随时间增长，需定期清理。保留策略：
- 默认保留 90 天数据
- 可在 config.yaml 中配置 `retention_days`
- 每次日报 trigger 执行时自动清理过期数据

## 定时触发

使用 Claude Code Cloud Scheduled Trigger：

| Trigger | 频率 | 职责 |
|---------|------|------|
| daily | 每天早上执行 | 抓取新文章 + 分析 + 生成日报 + 清理过期数据 |
| weekly | 每周一执行 | 从 history.json 汇总近 7 天 + 生成周报 |
| monthly | 每月 1 日执行 | 汇总近 30 天 + 生成月报 |

每次触发都会 fresh clone 仓库，完成后 commit & push。Trigger 通过 `/schedule` 命令创建和管理，配置存储在 Anthropic 云端，不在仓库内。

## 配置文件完整示例

```yaml
output_path: "./reports"
retention_days: 90

categories:
  - "模型发布"
  - "研究"
  - "产品与功能"
  - "商业动态"
  - "政策与安全"
  - "教程与观点"

analysis:
  dimensions:
    - name: tags
      prompt: "提取 3-5 个关键词标签"
      type: list
      render: inline_tags

    - name: practice_suggestions
      prompt: "如果涉及可上手尝试的产品或功能，给出实践建议"
      condition: "category in ['模型发布', '产品与功能']"
      type: list
      render: callout_block

sources:
  - name: "Berkeley RDI"
    type: rss
    url: "https://berkeleyrdi.substack.com/feed"

  - name: "The Batch"
    type: web_scraper
    url: "https://www.deeplearning.ai/the-batch"

  - name: "OpenAI Blog"
    type: rss
    url: "https://openai.com/blog/rss.xml"

  - name: "Google AI Blog"
    type: rss
    url: "https://blog.google/technology/ai/rss/"

  - name: "Anthropic Blog"
    type: rss
    url: "https://www.anthropic.com/blog/rss.xml"
```

## 错误处理

- 单个数据源抓取失败不阻塞其他源，报告中标注该源本次未能获取
- WebFetch 超时或返回异常内容时跳过该源
- 分析失败的文章仍记录到 history.json，标记为未分析，下次运行可补充

## 已知限制

1. **history.json 增长** — 通过 retention_days 配置定期清理
2. **WebFetch 反爬** — 部分网站可能屏蔽，需观察实际效果并调整
3. **Cloud trigger 最小间隔 1 小时** — 对日报场景完全够用
4. **每次 fresh clone** — 仓库不宜过大，长期需关注 reports 目录体积
5. **Twitter/X 暂不支持** — 后续可考虑通过 RSS bridge 或 API 接入

## 后续扩展方向

- 接入 Twitter/X 数据源
- 新增分析维度（如 sentiment、技术难度评估）
- 报告模板自定义
- 多语言支持（中英双语报告）
