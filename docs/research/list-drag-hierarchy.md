# 树形列表拖拽：同级项与子项判定调研

调研日期：2026-08-10。范围仅限产品官方帮助中心与维护方公开源码；没有把观察视频、博客或第三方复刻实现当作依据。

## 结论

“目标行 + before/after”不足以表达树形拖拽。应先将鼠标位置解析为**结构化落点**（目标父列表、插入索引、语义），再由该落点同时驱动指示线和最终文档变换。最小的语义集合是：`before`、`after`、`inside`。

对 Bitty Note 的单手柄列表，推荐采用“纵向三段 + 横向确认”的组合：

1. 普通列表项标题行的上 25%：`before`，插入目标项之前、保持目标项的父列表。
2. 普通列表项标题行的下 25%：`after`，插入目标项之后、保持目标项的父列表。**这条优先级最高：即使目标项已有子项，也绝不能把它解释成第一个子项。**
3. 标题行中间 50%：候选 `inside`。只有指针额外跨过“子级缩进确认线”才成为子项；否则回退为 `after`，使从左侧手柄直向下拖动稳定地产生同级项。
4. 指向既有第一个子项的上 25%：`before` 该子项。因为这个子项所属的父列表正是父项的嵌套列表，结果天然是“成为父项的第一个子项”。这正对应“位于子项上方，可以是子项”，不应再把它重写为“父项之后”。

示例（`P` 的第一个子项为 `C`）：

```text
P                 上缘：P 之前（与 P 同级）
                  中部且越过缩进确认线：P 的子项
                  下缘：P 之后（与 P 同级）
  C               上缘：C 之前（即 P 的第一个子项）
```

这套规则同时修正当前两类互相冲突的直觉：在 `P` 的下方明确是“同级”，在 `C` 的上方明确是“子项”；没有把整个父项及其子树当成一个笼统的 `after` 命中区。

## 一手资料中的可复用规则

### Atlassian Pragmatic Drag and Drop：明确的三区命中与指令

Atlassian 的公开 `tree-item` 命中实现把标准树项的顶部四分之一判为 `reorder-above`、底部四分之一判为 `reorder-below`、中间半区判为 `make-child`。因此“行底部”与“成为子项”是两个不同指令，而非用同一个 `after` 再由数据层猜测。[官方源码：`tree-item.ts`](https://raw.githubusercontent.com/atlassian/pragmatic-drag-and-drop/main/packages/hitbox/src/tree-item.ts)

其 `expanded` 模式还保留顶部四分之一为 `reorder-above`，其余区域为 `make-child`；最后一个分组项的左侧空白区则通过鼠标 x 坐标和 `floor((x - left) / indentPerLevel)` 得到目标层级，并把“上半部”与“中线及以下”分成 `reorder-above` / `reparent`。这说明：当空间表达的是层级时，应该把 x 轴作为独立维度，而不是用 y 轴推断层级。[同一官方源码](https://raw.githubusercontent.com/atlassian/pragmatic-drag-and-drop/main/packages/hitbox/src/tree-item.ts)

它也把 `reorder-above`、`reorder-below`、`make-child`、`reparent` 和 `instruction-blocked` 表示为互斥指令。最后一种可用于“不允许把项拖入自身后代”“目标不能容纳子项”等情形；不显示成功落点比显示一个实际会被改写的落点更少歧义。[同一官方源码](https://raw.githubusercontent.com/atlassian/pragmatic-drag-and-drop/main/packages/hitbox/src/tree-item.ts)

### dnd-kit 官方 Tree 示例：横向阈值、层级上界和下界

dnd-kit 的官方 Tree 示例把树拍平成可排序的一维序列；拖拽父项时先从候选序列移除其所有后代，避免向自己的子树落下。纵向碰撞定位 `overId`，横向拖动距离再单独投影为层级。[官方示例：`SortableTree.tsx`](https://raw.githubusercontent.com/clauderic/dnd-kit/master/stories/3%20-%20Examples/Tree/SortableTree.tsx)

该示例以 `Math.round(offset / indentationWidth)` 把横向偏移换成层级变化，默认 `indentationWidth` 为 50px；也就是说，跨过约半个缩进宽度才会改变一层。投影结果还被限制在 `nextItem.depth`（最小深度）与 `previousItem.depth + 1`（最大深度）之间：不能凭一次拖拽跳过中间父级，也不会制造没有合法父项的层级。[官方示例：`utilities.ts`](https://raw.githubusercontent.com/clauderic/dnd-kit/master/stories/3%20-%20Examples/Tree/utilities.ts)

Bitty Note 不必照搬 50px：应使用实际的列表缩进宽度 `I`，把确认线设为 `目标标题文本左缘 + I / 2`（并保留约 8px 的迟滞带，避免在线附近闪烁）。这相当于沿用官方示例的“半个缩进才换层”原则，同时让单手柄从左侧直上直下的常见轨迹保持同级。

### Workflowy / Notion：用户可见语义与反馈

Workflowy 官方帮助明确把嵌套定义为“移到另一项下面”，并要求移动带子项的 bullet 时，所有嵌套项随主项移动；这支持 Bitty Note 的“列表项拖动的是完整子树”不变量，但其公开帮助没有披露像素命中阈值。[Workflowy 官方帮助：Bullets](https://workflowy.com/help/bullets)

Notion 官方帮助说明所有内容块都可通过 `⋮⋮` 手柄拖动，并以蓝色引导线显示最终位置；该帮助同样未公开同级/子级判定的像素阈值。因此可借鉴的是“手柄 + 明确落点反馈”的交互约定，不能把 Notion 当作某个阈值数值的证据。[Notion 官方帮助：Writing and editing basics](https://www.notion.com/help/writing-and-editing-basics)

### ProseMirror：保证合法树，而非规定鼠标策略

ProseMirror 的列表 schema 要求列表项内容形状能容纳段落及嵌套列表（例如 `paragraph (ordered_list | bullet_list)*`）。其 `sinkListItem` 只能将项下沉到紧邻的前一个同级列表项之下；第一个项不能下沉。实现落点时应在提交前执行等价的结构合法性检查，而不能只按视觉行号移动。[官方源码：`schema-list.ts`](https://raw.githubusercontent.com/ProseMirror/prosemirror-schema-list/master/src/schema-list.ts)

ProseMirror 自带 drop cursor 先以 `posAtCoords` 得到文档坐标，再用 `dropPoint` 寻找可插入位置；块级落点绘制为跨块宽度的线，并按 `offsetParent`、`scrollLeft` / `scrollTop` 换算位置。这是“指示线必须是文档坐标的一部分，滚动时随文本移动”的直接实现参考。[官方源码：`dropcursor.ts`](https://raw.githubusercontent.com/ProseMirror/prosemirror-dropcursor/master/src/dropcursor.ts)

## Bitty Note 落点与指示线规格

### 1. 先解析结构化意图

不要让 `after + target has children` 隐式变成“插入第一个子项”。解析函数应返回如下信息（名称仅是说明，不要求按此命名）：

```ts
type ListDropIntent = {
  kind: "before" | "after" | "inside";
  parentListPath: number[];
  insertionIndex: number;
  anchorRow: RowDescriptor;
};
```

- `before C`：`parentListPath` 是 `C` 所在列表，`insertionIndex` 为 `C` 的索引；若 `C` 是 `P` 的第一子项，结果就是 `P` 的第一个子项。
- `after P`：`parentListPath` 是 `P` 所在列表，`insertionIndex` 为 `P` 的索引加一；无论 `P` 是否有子项，均是 `P` 的同级后项。
- `inside P`：目标父列表是 `P` 的嵌套列表；已有子项时，建议默认追加到末尾（与“放入 P”一致），而“放在第一个子项上方”仍由 `before C` 负责。

标题/章节保留现有的整章边界规则，与普通列表的 `inside` 规则分开处理；标题不是树形列表项，不能因新增列表规则而允许插入章节内部。

### 2. 可见反馈必须与结构意图一一对应

| 意图 | 指示线位置 | 建议辅助反馈 |
| --- | --- | --- |
| `before` | 目标标题行顶边 | 线从该层级的文本左缘开始 |
| `after` | 目标标题行底边，而非整个子树底边 | 线从目标项同级的文本左缘开始 |
| `inside` | 目标标题行底边或其嵌套列表起始处 | 指示线向右缩进一层；可加“作为子项”文字或图标 |

特别地，拖到 `P` 下缘显示的必须是同级缩进线；拖到 `C` 上缘显示的是子级缩进线。这样用户无需在松手后才知道这两个相邻位置的不同含义。

### 3. 约束与无效状态

- 拖动源的完整后代应从命中候选中排除，且禁止 `inside` 自身或任一后代。
- `inside` 只对可承载嵌套列表的普通列表项开放；标题、段落和不兼容的列表类型应只给合法的同级落点或不显示指示线。
- 投影深度最多比前一个可见项深一层，并且不能浅于后一个可见项所需的深度；这沿用 dnd-kit 官方示例的合法层级边界。
- 坐标变化必须在滚动后重新以目标元素的 `getBoundingClientRect()` / 文档位置计算；浮在 viewport 上的固定线会与实际事务落点脱节。

## 建议的验收用例

以 `A`、`P` 为同级、`C` 为 `P` 的第一个子项为例，拖动 `X`：

1. 落在 `P` 标题行下四分之一：`X` 成为 `P` 后的同级项，`C` 仍属于 `P`。
2. 落在 `C` 标题行上四分之一：`X` 成为 `P` 的子项且位于 `C` 前。
3. 落在 `P` 标题行中部，且 x 越过子级确认线：`X` 成为 `P` 的子项；未越过则为 `P` 后的同级项。
4. `X` 自带子项时，以上任一合法操作都携带 `X` 的完整子树；拖向 `X` 的后代不显示落点。
5. 滚动编辑器后，指示线仍锚定相同文档边界，并随目标行滚出可视区域。

