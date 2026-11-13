# SAUMCL

**SAU Minecraft Launcher** 是面向四川农业大学（SAU）玩家社群的 Minecraft Java 版启动器，基于 [SJMCL](https://github.com/UNIkeEN/SJMCL) 开发。

[English](../README.md) · **简体中文** · [繁體中文](README.zh-Hant.md)

## 下载

在 [GitHub Releases](https://github.com/Supaio/SAUMCL/releases/latest) 或 [GitLab Releases](https://gitlab.com/Supaio/saumcl/-/releases/permalink/latest) 下载 **Indev 19.4**。

- Windows x64：`SAUMCL.exe`。
- Linux x64：`SAUMCL`，运行前执行 `chmod +x ./SAUMCL`。
- `SHA256SUMS.txt` 提供下载文件的校验值。

欢迎窗口与“关于”页包含面向四川农业大学在校学生、毕业校友及 CLMC 群友（群号：719489600）的社群使用提醒。

## 当前功能

- Microsoft 正版账号登录、游戏安装和 Java 下载。
- 实例管理和 Modrinth 资源下载。
- 简体中文、繁体中文和英语。
- SAUMCL 标识、校服背景和左侧自适应导航。
- 从 GitHub 和 GitLab Releases 检查更新，包括更高版本的 Indev。

Microsoft 账号验证仍沿用 SJMCL 的 OAuth 应用，登录面板与“关于”页均已说明。智能与扩展插件功能暂时停用；校服停服期间尚未完成校服联机验证。

## 开发

需要 Node.js 22 或更高版本、pnpm **10.26.1**、Rust **1.98.1 或更高版本**，以及所在平台的 Tauri 构建依赖。

```sh
git clone https://gitlab.com/Supaio/saumcl.git SAUMCL
cd SAUMCL
pnpm install --frozen-lockfile
pnpm tauri dev
```

`main` 保存当前 SAUMCL 基底，后续开发使用 `codex/gitlab-migration`。

Windows／Linux 安装包统一构建，发行说明审核通过后同步发布到 GitHub 和 GitLab。

问题反馈请提交至 [Supaio/SAUMCL/issues](https://gitlab.com/Supaio/saumcl/-/issues)。

## 上游与许可证

SAUMCL 基于 **SJMCL**：https://github.com/UNIkeEN/SJMCL。原项目版权 © 2024–2026 SJMCL Team；SAUMCL 修改部分版权 © 2026 SAUMCL contributors。

请参阅 [LICENSE](../LICENSE) 与 [LICENSE.EXTRA](../LICENSE.EXTRA)。保留已有第三方声明与上游致谢。
