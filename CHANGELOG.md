# Changelog

## v1.8.2 — 2026-09-11

### English

- Preserve every note that was open when the manager begins closing, regardless of the number of note windows or asynchronous close order.
- Keep the manager completely hidden on the next launch whenever one or more saved note windows are restored.

### 简体中文

- 主面板开始关闭时会保留当时打开的所有便签，不再受便签数量或异步关闭顺序影响。
- 下次启动只要恢复了一个或多个便签，主面板就始终保持隐藏。

## v1.8.1 — 2026-09-10

### English

- Restored the last open note window on the next launch when the manager had already been closed, while keeping the manager hidden whenever notes are restored.
- Eliminated the brief blank manager flash during startup by resizing hidden WinForms windows without implicitly showing them; note windows now appear only after their content is ready.
- Cleared the note title-bar menu's lingering hover indicator after closing the menu with a second pointer click.

### 简体中文

- 主面板已关闭时退出应用，会在下次启动恢复最后一个仍打开的便签；恢复便签期间主面板保持隐藏。
- 隐藏的 WinForms 窗口调整尺寸时不再被意外显示，消除了启动期间短暂闪现的空白主面板；便签内容就绪后才会显示窗口。
- 修复用鼠标再次点击关闭便签标题栏菜单后，移开指针仍残留菜单指示状态的问题。

## v1.8.0 — 2026-09-10

### English

- Reworked the app around a note-list manager and independent note windows: cards now open directly in their own windows, open notes are restored at startup without forcing the manager open, and each note can reopen the manager from its menu.
- Redesigned the note title bar and single-level action menu with clearer pin state, create, minimize, rename, background color, open-list, and close-window controls.
- Added per-note background colors stored in Markdown front matter, with color-aware interaction states and subtle colored card edges on the home and archive pages while keeping the reading surface consistent.
- Made row-drag previews translucent so target content stays visible, reduced their shadow, and restored full opacity only while drag-to-delete is active.
- Updated the bundled Skill to preserve front matter during normal content edits and change `bitty-background` only when explicitly requested.

### 简体中文

- 将应用调整为“便签列表主面板 + 独立便签窗口”的结构：便签卡片改为直接在独立窗口打开；启动时只恢复上次开启的便签，不强制显示主面板；便签菜单可随时重新打开列表。
- 重新设计便签标题栏和单层操作菜单，明确整合置顶状态、新建、最小化、重命名、背景颜色、打开便签列表和关闭窗口等操作。
- 新增通过 Markdown front matter 保存的单便签背景颜色，并让交互状态随颜色协调变化；首页和归档页以轻微立体的彩色下边缘表达颜色，同时保持阅读区域一致。
- 拖动行时的预览卡改为半透明并减弱阴影，便于观察目标位置；仅在触发拖动删除时恢复完全不透明。
- 更新内置 Skill：普通正文编辑会完整保留 front matter，只有用户明确要求时才修改 `bitty-background`。

## v1.7.0 — 2026-09-08

### English

- Added an option to open a note in the default Markdown editor from the home context menu, along with compact scroll controls for returning to the top and creating a note.
- Simplified highlight editing so punctuation can be entered at the middle or boundary of highlighted text without duplication or unexpected caret movement.
- Reliably clear dragged text selections whenever the app loses focus, including after interacting with the title bar.
- Delay separate note windows until their content is ready, with timeout feedback instead of leaving an unresponsive blank window.
- Restore every separately opened note after restart while preserving its last normal position and size as closely as the current display permits.

### 简体中文

- 首页右键菜单支持使用默认 Markdown 编辑器打开便签，并增加紧凑的回到顶部和新建便签滚动操作。
- 简化高亮文本编辑逻辑，在高亮内部或边界输入标点时不再重复输入或异常移动光标。
- 窗口失去焦点时可靠取消拖选范围，包括先与标题栏交互后再切换到窗口外的情况。
- 独立便签窗口会在内容就绪后再显示，超时时给出错误提示，避免留下无响应的纯色窗口。
- 重启后恢复上次打开的全部独立便签，并在当前屏幕可用范围内尽量保留它们的位置和尺寸。

## v1.6.0 — 2026-09-06

### English

- Added a Settings entry that provides a selectable installation prompt for connecting Bitty Note to AI agents through the bundled Skill.
- Expanded note context menus with Lucide icons, copy, pinning, archive, restore, and Recycle Bin actions; destructive moves now require an in-place second confirmation.
- Added middle-click opening in a separate note window and increased note-card title text for readability.
- Grouped the home list into Pinned and Recently edited sections, keeping both groups ordered by edit time and pin state synchronized across renames, archive operations, and restored notes.

### 简体中文

- 在设置中增加 Skill 获取入口，提供可选择、可复制的安装提示词，用于将 Bitty Note 接入 AI Agent。
- 扩展便签右键菜单并补充 Lucide 图标，支持复制、置顶、归档、还原及移至回收站；危险操作需在原位置二次确认。
- 支持鼠标中键在独立便签窗口中打开记录，并增大便签卡片标题字号以提升可读性。
- 首页增加“置顶”和“最近编辑”分组，两组均按编辑时间排序，并确保重命名、归档及还原后的置顶状态保持同步。

## v1.5.4 — 2026-09-04

### English

- Made title-bar actions respond to the first click when a note window is inactive, including Back, New note, Always on top, and Minimize across main and separate note windows.
- Preserved startup cleanup for stale hover and focus states without disabling title-bar pointer handling during normal window activation.

### 简体中文

- 便签窗口失去焦点后，标题栏的返回、新建、置顶和最小化按钮现在首次点击即可生效，覆盖主窗口和独立便签窗口。
- 保留启动时对陈旧悬浮及焦点状态的清理，同时避免在普通窗口激活时临时关闭标题栏指针响应。

## v1.5.3 — 2026-09-01

### English

- Kept drag-to-delete danger-card text centered while fully visible, shifting it only as far as needed when the card extends beyond the window.
- Constrained the text to the card's inner padding, maximized its visible area when full visibility is impossible, and recalculated placement during dragging and window resizing.

### 简体中文

- 拖动删除危险卡片的文字在可完整显示时保持居中；卡片超出窗口时，仅做保证可见所需的最小偏移。
- 文字始终受卡片内边距约束；无法完整显示时选择窗口内可见面积最大的位置，并在拖动及窗口尺寸变化时重新计算。

## v1.5.2 — 2026-08-31

### English

- Required at least 180 px of current rightward travel before drag-to-delete can activate, even when a long preview overlaps a viewport-clamped target in a narrow window.
- Increased the preferred gap between the floating preview and delete target to 180 px, and cancel deletion immediately when the pointer moves back inside the travel threshold.

### 简体中文

- 行拖动删除必须保持至少 180px 的当前向右位移才能激活；即使窄窗口中的长预览卡提前重叠被边界限制的删除目标，也不会误进入删除态。
- 将浮动预览卡与删除目标的期望间距增加到 180px；指针退回位移门槛以内时立即取消删除态。

## v1.5.1 — 2026-08-31

### English

- Restored row-handle range feedback to the subtle filled background, removing the distracting outer shadow while preserving the full affected range.
- Moved the drag-to-delete target farther from the floating preview, increasing the separation to reduce accidental deletion activation.

### 简体中文

- 将行拖动手柄的范围反馈恢复为轻量背景填色，移除干扰视觉的外阴影，同时继续覆盖完整受影响范围。
- 将拖动删除目标进一步移离浮动预览卡，增大间距以降低误触删除的可能性。

## v1.5.0 — 2026-08-30

### English

- Redesigned row drag deletion with a nearby target, overlap-based activation and hysteresis, clearer danger feedback, stronger depth shadows, and a solid red delete button with a white icon.
- Kept nested-list drop guides close to the pointer by treating the space below an expanded parent as the first visible child slot, while collapsed parents continue to move as a single block.
- Kept the menu bar, formatting toolbar, and editor caret hidden when a window starts or returns from the taskbar, preventing stale focus from appearing on controls or in the editor.
- Made GitHub release preflight compatible with Windows PowerShell 5 and added a regression test for the missing-release path.

### 简体中文

- 重新设计行拖拽删除：删除目标靠近拖拽行，基于重叠和迟滞进入危险态，并强化危险反馈、立体阴影以及红底白色图标的删除按钮。
- 让嵌套列表的插入提示保持在鼠标附近：展开父项下方对应第一个可见子项槽位，收起父项仍作为整体移动。
- 窗口启动或从任务栏恢复时，保持菜单栏、格式工具栏和编辑器光标隐藏，避免控件或编辑器残留焦点。
- 提升 GitHub 发布预检对 Windows PowerShell 5 的兼容性，并为 Release 不存在的路径补充回归测试。

## v1.4.0 — 2026-08-29

### English

- Added text background highlighting in red, yellow, blue, and green, with Markdown-compatible syntax, a persisted preferred color, and a compact toolbar palette.
- Made overlapping and nested highlights serialize and reopen reliably, allowed spaces and punctuation to exit active highlight input, and rendered highlights in completed task rows as gray without changing their Markdown.
- Preserved the caret and child-list structure when converting list types, including indented sublists and mixed task, bullet, and ordered lists.
- Restored native taskbar-button behavior for the custom Windows frame: clicking the active app minimizes it, while clicking a minimized window restores it.
- Kept the menu bar and editing toolbar hidden and the editor unfocused on startup, and fixed title-bar dragging so the window stops immediately when the mouse button is released.
- Renamed the heading and list accent-color setting for clarity, removed spell-check settings and behavior, and strengthened the Windows pin and taskbar E2E checks against layout changes.

### 简体中文

- 新增红、黄、蓝、绿四色文字背景高亮，支持兼容 Markdown 的语法、持久化常用颜色和紧凑的工具栏色板。
- 提升交叠及嵌套高亮的序列化与重新打开稳定性；支持通过空格或标点退出高亮输入；已完成任务行中的高亮仅以灰色显示，不修改原 Markdown。
- 切换列表类型时保留光标和子列表结构，覆盖缩进子列表以及任务、项目符号和有序列表的混合场景。
- 为 Windows 自绘窗口恢复原生任务栏按钮行为：点击当前前台应用时最小化，点击已最小化窗口时恢复。
- 启动时保持菜单栏和编辑工具栏隐藏且编辑器不自动获得焦点，并修复标题栏拖动在松开鼠标后仍持续跟随的问题。
- 将标题与列表强调色设置改为更准确的名称，移除拼写检查设置及行为，并增强置顶与任务栏 E2E 脚本对工具栏布局变化的适应性。

## v1.3.10 — 2026-08-21

### English

- Made the original row or heading section semi-transparent while dragging, while keeping the floating preview fully opaque and applying the feedback without animation.
- Kept row-handle hover and drag backgrounds clipped to the visible editor area instead of disappearing when part of the feedback extends beyond the window.
- Hid the editor caret when the application window loses focus without clearing the logical selection or editing state.
- Enabled Per-Monitor V2 rendering for crisp text on mixed-DPI displays, restored secondary-monitor position and logical size accurately across restarts, and positioned the hidden startup window before its first visible frame.

### 简体中文

- 拖动行或标题章节时，将原位置内容设为半透明，同时保持浮动预览完全不透明，并且反馈不使用动画。
- 行手柄的悬停与拖动背景超出窗口时按编辑区可见范围裁切，不再因部分越界而整体消失。
- 应用窗口失去焦点时隐藏编辑器光标，同时保留逻辑选区和编辑状态。
- 启用 Per-Monitor V2，在混合 DPI 显示器上保持文字清晰；重启后准确恢复副屏位置与逻辑尺寸，并在启动窗口首次可见前完成定位。

## v1.3.9 — 2026-08-15

### English

- Added note renaming from the home-page context menu and directly from an open note's title, with conflict feedback and coordination for notes already open in another window.
- Added dedicated note windows from the home-page context menu, including focus reuse for notes already open, independent per-note window sizes, synchronized pin state, and coordinated saves and updates.
- Made task checkboxes scale with editor line height while keeping their rounded outlines, row-to-row dimensions, and checkmark alignment visually stable.
- Kept the drag-to-delete target inside the usable window area and snapped its final position to whole pixels for consistent border rendering.

### 简体中文

- 支持从主页右键菜单重命名便签，也可直接双击已打开便签的标题重命名；名称冲突会就地提示，已在其他窗口打开的便签会自动协调处理。
- 支持从主页右键菜单在独立窗口打开便签；已打开的便签会复用并聚焦原窗口，同时保存各便签的独立窗口尺寸，并同步置顶状态、保存与更新流程。
- 任务复选框会随编辑器行高缩放，同时保持圆角描边、连续多行尺寸和勾号位置稳定一致。
- 拖动删除目标会限制在窗口可用区域内，并将最终位置吸附到整数像素，使描边显示保持一致。

## v1.3.8 — 2026-08-13

### English

- Made insert actions below folded headings expand the section and place the caret on the resulting row, reusing an existing empty tail row instead of creating a duplicate.
- Preserved bullet, ordered, and task-list types when inserting after folded list content, including unchecked state for new task items.
- Reworked task checkboxes as stable 18 px SVG controls so their outlines and checkmarks stay visually consistent across consecutive rows.
- Enlarged the drag-to-delete target and its contents for clearer feedback and easier targeting.

### 简体中文

- 点击折叠标题下方的插行入口后自动展开章节并将光标定位到结果行；末尾已有空行时直接复用，不再重复新增。
- 在折叠列表内容后插行时延续项目符号、有序列表或任务列表类型，新任务项保持未勾选。
- 将任务复选框调整为稳定的 18px SVG 控件，使连续多行的外框和勾号保持一致。
- 放大拖动删除目标及其内部元素，使反馈更清晰、更容易命中。

## v1.3.7 — 2026-08-11

### English

- Stabilized drag hit testing at the document tail so the terminal blank row and the visual space below it share the same drop guide position.
- Kept document-end actions and caret placement consistent while dragging near folded or empty content.

### 简体中文

- 稳定文档末尾的拖动命中，让末尾空行与下方视觉空白区域使用同一引导线位置。
- 拖动到折叠或空内容附近时，保持文档末尾操作入口与光标定位行为一致。

## v1.3.6 — 2026-08-11

### English

- Made undo and redo preserve the original operation's viewport intent: text edits reveal their restored caret, while task checks, row operations, folding, and toolbar formatting keep the current viewport.
- Prevented window-level undo and redo from stealing focus, showing the toolbar, or scrolling the note when the editor is unfocused.

### 简体中文

- 让撤销和重做继承原操作的视口意图：文本编辑会显示恢复后的光标，任务勾选、行操作、折叠和工具栏格式化则保持当前视口。
- 编辑器失焦时，通过窗口快捷键撤销或重做不再抢占焦点、显示工具栏或滚动便签。

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
