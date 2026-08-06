# BRD — Business Requirements Document

## 项目名称

**WhatsApp Task Agent** — 基于 WhatsApp 的 AI 任务管理助手

## 版本

v2.0 (2026-08-06)

## 1. 项目背景

### 1.1 问题陈述

中小型服务企业（移民咨询、律师、会计、留学中介等）的客户沟通高度依赖 WhatsApp。客户随时通过 WhatsApp 发来各种待办事项、文件需求、截止日期，但运营人员难以及时记录、归类、追踪这些零散信息。

传统 CRM 系统需要手动录入，学习成本高，使用率低。WhatsApp 本身没有任务管理能力，消息容易被淹没。

### 1.2 解决方案

一个轻量级的 AI 代理，监听 WhatsApp 消息，用户只需在消息前加 `/t` 前缀，AI 就自动提取任务内容、优先级和截止时间，存入数据库，在 Web Dashboard 统一管理。

### 1.3 核心价值主张

> "像聊天一样管理任务。不需要学任何新系统。"

## 2. 目标用户

### 2.1 主要用户

| 角色 | 场景 | 痛点 |
|---|---|---|
| 移民顾问 | 客户发"周五前交护照扫描件"，需要记录+提醒 | WhatsApp 消息太多，容易漏 |
| 律师/会计师 | 客户随时提需求，需要按优先级排序 | 没有轻量工具，用 Excel/Notes 凑合 |
| 小团队管理者 | 微信/WhatsApp 上口头分配任务 | 没有追踪，不知道做没做 |
| 自由职业者 | 自己给自己派任务，需要简单快速 | 不想装复杂的任务管理 App |

### 2.2 次要用户

- 家庭成员共享任务清单
- 学生管理学业截止日
- 小电商客服跟踪售后工单

## 3. 业务目标

| 指标 | 目标值 | 衡量方式 |
|---|---|---|
| 任务创建速度 | < 5 秒/条 | 发 `/t` 后到 Dashboard 出现任务的时间 |
| AI 提取准确率 | > 90% | 标题/优先级/日期是否需要手动修改 |
| 系统可用性 | > 99% | Bridge + Railway 在线时间 |
| 用户上手时间 | < 10 分钟 | 从 fork 到发出第一条 `/t` 的时间 |
| 月度运营成本 | < ¥10 | Railway Free + Supabase Free + DeepSeek API |

## 4. 功能范围

### 4.1 MVP (已完成)

- [x] WhatsApp 消息接收 (Baileys v7 Bridge)
- [x] `/t` 命令触发 AI 分析
- [x] DeepSeek AI 提取任务 (标题/优先级/截止日)
- [x] 相对时间解析 ("周五" → 实际日期)
- [x] Supabase PostgreSQL 持久化
- [x] Web Dashboard (任务 CRUD/搜索/打勾)
- [x] Railway 云部署 (Task API)
- [x] macOS launchd 开机自启
- [x] 支持自己发给自己的消息

### 4.2 后续版本

- [ ] 定时提醒推送 (每日/每周总结)
- [ ] 多用户支持 (区分不同 WhatsApp 号码)
- [ ] `/t done` 标记完成任务
- [ ] `/t 今天` 查询今日任务
- [ ] WhatsApp 直接回复任务状态
- [ ] 与 Notion/Todoist 双向同步
- [ ] Windows/Linux 自启方案
- [ ] Docker 一键部署

## 5. 成本分析

| 项目 | 月费用 |
|---|---|
| Railway (Task API) | $0 (免费额度 $5/月) |
| Supabase (数据库) | $0 (免费额度 500MB) |
| DeepSeek API | ~¥2-5 (按 500-1000 条/月估算) |
| 本地电脑 (Bridge) | 电费约 ¥15-30/月 |
| **总计** | **< ¥35/月** |

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| WhatsApp 封号 (Baileys 非官方 API) | 服务中断 | 用官方 Business API 替代（后续） |
| DeepSeek API 不可用 | 无法创建任务 | 支持切换 OpenAI/Claude 模型 |
| 电脑关机导致 Bridge 离线 | 消息丢失 | 消息入队，Bridge 重连后补发 |
| Railway 免费额度超标 | 服务暂停 | 监控用量，按需升级 |

## 7. 竞品分析

| 产品 | 优势 | 劣势 |
|---|---|---|
| Todoist | 功能强大 | 需单独打开 App，WhatsApp 不能直接创建 |
| Notion | 灵活 | 学习成本高，太重量级 |
| 微信用提醒 | 零成本 | 无法结构化、无法排序、无法管理 |
| 本工具 | WhatsApp 原生体验、AI 提取、零学习成本 | 需自部署、依赖 WhatsApp 非官方 API |

## 8. 商业模式 (可选)

目前为开源免费工具。未来可考虑：
- SaaS 托管版 ($5/月/用户，无需自部署)
- 企业版 (多用户 + 权限管理 + SLA)
- WhatsApp Business API 正式版 (合规 + 无封号风险)

## 9. 术语表

| 术语 | 含义 |
|---|---|
| Bridge | 本地运行的 WhatsApp 网关，连接 WhatsApp 服务器和 Railway API |
| `/t` 命令 | 触发 AI 分析的 WhatsApp 消息前缀 (t = task) |
| Task API | Railway 上运行的 Express 后端服务 |
| Dashboard | Web 管理面板 (纯前端 SPA) |
| launchd | macOS 系统级进程管理器，用于开机自启 Bridge |
