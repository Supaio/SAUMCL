# SAUMCL

**SAU Minecraft Launcher** 是面向四川农业大学（SAU）玩家社群的 Minecraft Java 版啟動器，基於 [SJMCL](https://github.com/UNIkeEN/SJMCL) 開發。

[English](../README.md) · [简体中文](README.zh-Hans.md) · **繁體中文**

## 下載

在 [Supaio/SAUMCL Releases](https://gitlab.com/Supaio/saumcl/-/releases) 下載 **Indev GL 19.3**。

- Windows x64：`SAUMCL.exe`。
- Linux x64：`SAUMCL`，執行前先執行 `chmod +x ./SAUMCL`。
- `SHA256SUMS.txt` 提供下載檔案的校驗值。

歡迎視窗與「關於」頁包含面向四川农业大学在校學生、畢業校友及 CLMC 群友（群號：719489600）的社群使用提醒。

## 目前功能

- Microsoft 正版帳戶登入、遊戲安裝和 Java 下載。
- 實例管理和 Modrinth 資源下載。
- 簡體中文、繁體中文和英語。
- SAUMCL 標識、校服背景和左側自適應導覽。
- 從本倉庫的 Releases 檢查更新，包括更高版本的 Indev。

Microsoft 帳戶驗證仍沿用 SJMCL 的 OAuth 應用，登入面板與「關於」頁均已說明。智慧與擴充外掛功能暫時停用；校服停服期間尚未完成校服連線驗證。

## 開發

需要 Node.js 22 或更新版本、pnpm **10.26.1**、Rust **1.98.1 或更新版本**，以及所在平台的 Tauri 建置依賴。

```sh
git clone https://gitlab.com/Supaio/saumcl.git SAUMCL
cd SAUMCL
pnpm install --frozen-lockfile
pnpm tauri dev
```

`main` 儲存目前 SAUMCL 基底，後續開發使用 `codex/gitlab-migration`。

GitLab CI 负责 Windows／Linux 构建、检查与安装包上传。公开 Release 前须先审核发行说明；旧 GitHub 流程保留供参考。

問題回報請提交至 [Supaio/SAUMCL/issues](https://gitlab.com/Supaio/saumcl/-/issues)。

## 上游與许可证

SAUMCL 基於 **SJMCL**：https://github.com/UNIkeEN/SJMCL。原專案版權 © 2024–2026 SJMCL Team；SAUMCL 修改部分版權 © 2026 SAUMCL contributors。

請參閱 [LICENSE](../LICENSE) 與 [LICENSE.EXTRA](../LICENSE.EXTRA)。保留既有第三方聲明與上游致謝。
