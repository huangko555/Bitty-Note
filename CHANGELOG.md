# Changelog

## v1.3.5 — 2026-08-11

### English

- Aligned the terminal blank-row drop guide with the guide shown in the visual space below it.
- Matched folded-child hover highlighting to the content-width boundary used by inside drop targets, without changing the fold button hover effect.

### 简体中文

- 统一末尾空行尾部与下方视觉空白区域的拖放引导线位置。
- 将折叠子项的悬停背景改为与内部拖放目标相同的内容宽度边界，同时保持折叠按钮自身的 hover 效果不变。

## v1.3.4 — 2026-08-11

### English

- Prevented passive editor changes, including checking tasks and deleting dragged rows, from jumping the viewport to a stale selection at the document start.
- Kept toolbar formatting at the current viewport while preserving normal caret-following for direct text edits, undo, and redo.

### 简体中文

- 修复勾选任务、拖动删除行等被动编辑操作可能跟随旧选区跳到文档开头的问题。
- 工具栏格式化时保持当前视口，同时保留直接文本编辑、撤销和重做时正常跟随光标的行为。

## v1.3.3 — 2026-08-11

### English

- Separated the document-end action area from real blank rows so terminal highlighting, insertion, and dragging stay accurate.
- Fixed insertion and drop behavior at folded document endings, including keeping the final action visible and expanding folded content atomically.
- Recovered the intended caret position when clicking text that becomes visible after expanding folded content.

### 简体中文

- 将文档末尾操作区与真实空行分离，使末尾高亮、插入和拖动命中保持准确。
- 修复折叠文档末尾的插入与拖放行为，包括保持末尾操作入口可见并原子展开折叠内容。
- 修复点击刚展开的折叠内容时光标可能被 WebView 覆盖的问题。

## v1.3.2 — 2026-08-11

### English

- Kept fold controls out of drag-preview text and made the preview count show only the additional rows moving with the selected row.

### 简体中文

- 避免折叠控件文字混入拖动预览，并将预览数量改为随当前行一起移动的额外行数。

## v1.3.1 — 2026-08-11

### English

- Fixed drag-handle hit testing when a folded final section contains the document's terminal blank line.

### 简体中文

- 修复末尾折叠章节包含文档空行时，拖动手柄命中检测异常的问题。

## v1.3.0 — 2026-08-11

### English

- Added persistent folding for heading sections and nested list branches, with hidden-row count badges and clear hover feedback.
- Preserved fold state in Markdown files without exposing internal markers in note previews.
- Refined row dragging with list-marker previews, stable section boundaries, smooth handle-area scrolling, and accurate terminal empty-row drop targets.
- Kept the viewport stable while folding, unfolding, and moving content across long notes.
- Improved Backspace behavior when joining task-list paragraphs and avoided unnecessary startup registry rewrites.

### 简体中文

- 为标题章节和多层列表分支增加可持久化的折叠功能，并显示隐藏行数徽标和明确的悬浮反馈。
- 将折叠状态保存在 Markdown 文件中，同时避免内部标记出现在便签摘要里。
- 完善行拖动体验，包括列表标记预览、稳定的章节边界、手柄区域平滑滚动和准确的末尾空行落点。
- 在折叠、展开以及长便签跨区域移动内容时保持视口稳定。
- 改进任务列表段落的退格合并行为，并避免重复写入开机启动注册表。

## v1.2.0 — 2026-08-10

### English

- Made heading rows move together with their complete sections while preserving section boundaries.
- Added explicit list drop zones for placing rows before, inside, or after list items while preserving hierarchy and list type.
- Kept the editor viewport at the drop location after moving content across long notes.
- Added a compact, opaque drag preview beside the pointer and restored source highlighting when dragged content returns to view.
- Placed the Markdown storage path on its own row with the action buttons below it.

### 简体中文

- 拖动标题行时会连同完整章节一起移动，并保持章节边界正确。
- 为列表增加明确的前方、内部和后方落点，同时保持层级关系与列表类型。
- 在长便签中跨区域移动内容后，编辑器视口会停留在松手位置。
- 增加位于指针旁的不透明简洁拖动预览，并在拖动内容重新进入视口时恢复来源高亮。
- Markdown 保存路径改为独占一行，操作按钮排列在下一行。

## v1.1.3 — 2026-08-09

### English

- Added clear progress feedback while downloading GitHub updates, including a notification, continuous icon animation, a disabled update button, and temporary update-dot hiding.

### 简体中文

- 为 GitHub 更新下载过程增加明确的进行中反馈，包括轻通知、持续旋转的更新图标、禁用更新按钮和临时隐藏更新红点。

## v1.1.2 — 2026-08-09

### English

- Made GitHub update checks use the static Velopack release manifest, avoiding GitHub API rate limits.
- Added distinct messages for update-check failures and download or installation failures.
- Added an undoable row-delete target when dragging a row by its handle, with precise release hit testing and preserved editor scroll position.
- Made undo and redo shortcuts work across the note window while preserving the behavior of other text inputs.

### 简体中文

- 将 GitHub 更新检查改为读取 Velopack 静态发布清单，避免 GitHub API 限流。
- 区分更新检查失败与下载或安装失败的提示。
- 增加通过行手柄拖动删除的可撤销目标，精确判断松开位置并保持编辑器滚动位置。
- 让撤销和重做快捷键在便签窗口内统一生效，同时保留其他文本输入框自身的快捷键行为。

## v1.1.1 — 2026-08-02

### English

- Fixed window-size persistence so the restored size matches the previous session.
- Standardized the language selector typography without changing its compact layout.
- Renamed the archive subfolder to `Archive` and automatically migrated the legacy `归档` folder without losing existing notes.

### 简体中文

- 修复窗口尺寸保持，使重启后的尺寸与上次使用时一致。
- 统一语言选择器的字体样式，同时保持紧凑布局不变。
- 将归档子目录改为 `Archive`，并自动迁移旧的 `归档` 文件夹，不丢失已有记录。

## v1.1.0 — 2026-08-02

> This prerelease is unsigned. Windows may display an unknown-publisher or SmartScreen warning. Do not treat it as the final stable package.

### English

- Added a complete English interface and made English the default language.
- Added a custom language selector in Settings for switching between English and Simplified Chinese.
- Updated the English page titles to `Bitty-Note`, `Settings`, and `Archive` while preserving the embedded title-font style.
- Changed the default notes folder to `Documents/Bitty-Note` for new users.
- Added daily update checks, manual update controls, update indicators, and Velopack-based GitHub updates.
- Added a direct GitHub project button in Settings.
- Unified lightweight notifications at the center of the title bar.
- Improved initial window sizing and window-size persistence across restarts.
- Added English-first and Simplified Chinese README pages with language-specific hero images.
- Added the MIT License, privacy policy, code-signing policy, third-party notices, and a traceable Windows build workflow.

### 简体中文

- 新增完整英文界面，并将英文设为默认语言。
- 在设置中增加自绘语言选择器，可切换英文和简体中文。
- 英文页面标题改为 `Bitty-Note`、`Settings` 和 `Archive`，并继续使用嵌入的标题字体风格。
- 新用户的默认记录目录改为 `Documents/Bitty-Note`。
- 增加每日更新检查、手动检查更新、更新红点以及基于 Velopack 的 GitHub 更新。
- 在设置中增加直接打开项目主页的 GitHub 按钮。
- 将轻通知统一到标题栏正中间。
- 改进首次启动窗口尺寸以及重启后的尺寸保持。
- README 改为英文主页和手动切换的中文版，两种语言分别使用对应首图。
- 增加 MIT 协议、隐私政策、代码签名政策、第三方许可声明和可追溯的 Windows 自动构建流程。
