# 福利速递与社群友链（Indev 19.3）

主页新增可移动、缩放并记忆布局的「福利速递」磁贴；左侧「社群友链」展示QQ群与网站卡片。没有自动审核通过的活动。友链按用户提供的内容分为两栏：第一栏为 SAUMCL 项目、Supaio 的 GitHub、四川农业大学 SAU 群、Oopz 语音和宣传网页；第二栏为 SUES、SWMU、SWUST、TYUT 大学群，按英文缩写排序。

## 收集和审核

激活维护Key后，在「设置 → 校服维护」底部打开「福利审核与社群友链」。本页打开时自动检查，成功采集间隔为6小时，每次扫描最近60篇 Minecraft 官方新闻，筛选披风、免费内容、奖励、兑换等关键词。仅访问现有官方新闻接口，不采集玩家的账号或兑换码。关闭客户端或离开维护页后不会在后台采集。

关键词仅产生候选，可能遗漏，也可能包含需要购买的推广。维护人员必须打开官方文章，核对奖励、适用版本、购买/地区等条件、领取链接和截止时间后，通过审核并保存。可以手动添加官方文章。同一篇文章的不同语言地址会去重，重新采集不会覆盖人工修改或忽略决定；编辑已通过活动的任何字段都会退回待审核。

日期可以是 `YYYY-MM-DD` 或带明确时区的 ISO 时间。仅公布日期时不补造精确时刻，玩家端按照设备日期判断该日是否已过，并提示以官方规则为准。知道确切时区与时刻时应填写 ISO 时间，例如 `2026-10-14T23:59:00-08:00`。需要兑换码的活动分别填写「获取资格截止」和「已有兑换码的兑换截止」；前者已过、后者未过时显示「仅限已有兑换码」。完全过期后不再展示，即使网络失败仍显示旧缓存，也会重新检查过期时间。

自动采集不会抓取文章全文或自行推断领取条件。官网单篇文章后续修改不会自动改变已审核推送，维护人员需要重新核对并审核。

## 本机预览与公开清单

保存草稿后可以应用/退出本机预览，在主页和友链页查看结果。未通过的活动、已忽略消息和未启用友链不会出现在预览或导出清单中。退出维护模式后不再读取本机预览。

「导出公开清单」生成 `community.json`，不包含维护Key、审核历史或候选消息。所有维护读写、采集、审核、预览和导出命令均在 Rust 端验证维护Key；不依赖前端隐藏按钮实现权限。

公开清单位于 `public/community.json`。19.3 已配置从自己仓库的统一静态地址读取审核后的清单：

`https://raw.githubusercontent.com/Supaio/SAUMCL/main/public/community.json`

`src/services/community.ts` 中的 `COMMUNITY_FEED_URL` 指向上述地址。玩家端每15分钟刷新、返回可见页面时检查，可手动刷新，失败后读取缓存或随包清单。公开地址需要对应文件进入 main 分支后才能生效。导出文件本身不向其他玩家发布；尚未实现客户端直接上传，不在玩家客户端保存 GitHub 发布凭据。

## 友链

维护页的「社群友链」中添加QQ群或网站卡片，选择所属栏目，填写名称、介绍及群号/网址，并启用后保存。各大学卡片名称以英文缩写开头，自动按字母排序；SAU 放在第一栏。QQ群可只显示群号与复制按钮；入群链接由维护人员提供，不自动推导。页面只接受普通 HTTP/HTTPS 链接，不自动加群或发送消息。首次建立维护草稿时从随包公开清单载入友链，避免初次保存覆盖已有内容。

## 社区新闻

「发现 → 社区新闻」固定使用 MUA 源 `https://mc.sjtu.cn/api-sjmcl/article/mua`，由启动器版本统一维护。玩家界面的数据源管理按钮、管理页和添加弹窗已移除，不提供添加、删除或启停新闻源的操作。旧配置中的 `discoverSourceEndpoints` 与 `discoverSourcesVersion` 不再读取或保存；导入旧设置也不会改变新闻源。

后端的新闻查询只接受固定 MUA 端点与原有 Minecraft 官方新闻端点；其他 URL 在发出网络请求前拒绝。MUA 的阅读、刷新和分页保持可用，未恢复已移除的 SJMC 发布者新闻。

## 调研来源（2026-10-25）

卡片图标使用随包文件：川农社群 Logo 由用户提供，SAUMCL Logo 沿用项目现有资源；作者头像取自 [Supaio 的 GitHub 头像](https://avatars.githubusercontent.com/u/145017690?v=4)，Oopz 图标取自[官网图标](https://staticcdn.oopz.cn/images/logo2.png)，宣传网页使用 [Chrome 官方图标](https://www.google.com/chrome/static/images/chrome-logo.svg)。这些图片随启动器打包，不依赖打开页面时联网加载。

- [Minecraft Dungeons II Capes Promos](https://www.minecraft.net/en-us/article/minecraft-dungeons-ii-capes-promos)：Aurora 披风的观看活动截止和代码兑换截止不同，说明为何需要「仅限已有兑换码」状态；文中付费内容不能一并标作无条件免费。
- [Camp Out Community Challenge](https://www.minecraft.net/en-us/article/camp-out-community-challenge)：包含 Java 皮肤与基岩版角色物品，需分辨适用版本及挑战、领取阶段。
- [Community Challenge: Chaos Sparks](https://www.minecraft.net/en-us/article/community-challenge-chaos-sparks)：包含免费附加包及外观奖励，福利类型不限于披风。

这些文章仅用于方案调研，没有未经人工审核加入玩家推送。
