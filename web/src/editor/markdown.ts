import MarkdownIt, {
  type Delimiter,
  type Env,
  type MarkdownIt as MarkdownItInstance,
  type StateBlock,
  type StateInline,
} from "markdown-it";
import taskLists from "markdown-it-task-lists";
import {
  DOMParser as ProseMirrorDOMParser,
  Fragment,
  type Node as ProseMirrorNode,
} from "prosemirror-model";
import { MarkdownSerializer } from "prosemirror-markdown";

import {
  DEFAULT_HIGHLIGHT_COLOR,
  isHighlightColor,
} from "./highlight";
import { noteSchema } from "./schema";

const EMPTY_PARAGRAPH_MARKER = "<!-- bitty-empty-line -->";
const EMPTY_PARAGRAPH_SENTINEL = "BITTY_EMPTY_PARAGRAPH";
export const FOLDED_MARKER = "<!-- bitty-folded -->";
const FOLDED_SENTINEL = "BITTY_FOLDED_ROW_7F4D";
const FOLDED_MARKER_PATTERN = /^(\s*(?:#\s+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?))<!-- bitty-folded -->\s?/gm;

function highlightTokenize(state: StateInline, silent: boolean): boolean {
  const marker = state.src.charCodeAt(state.pos);
  if (silent || marker !== 61) return false;
  const scanned = state.scanDelims(state.pos, true);
  let length = scanned.length;
  if (length < 2) return false;

  const colorPrefix = length >= 2
    ? state.src.slice(state.pos + length).match(/^\{([^}]+)\}/)
    : null;
  if (colorPrefix && !isHighlightColor(colorPrefix[1])) return false;
  const color = colorPrefix?.[1];
  const hasHighlightOpener = state.delimiters.some((delimiter) =>
    delimiter.marker === marker && delimiter.open && delimiter.end === -1,
  );
  const nextCharacter = state.src.charAt(
    state.pos + scanned.length + (colorPrefix?.[0].length ?? 0),
  );
  const canOpenPlain = scanned.can_open
    || (nextCharacter !== "" && !/\s/u.test(nextCharacter));
  const canClosePlain = scanned.can_close || hasHighlightOpener;

  if (length % 2) {
    const textMarker = state.push("text", "", 0);
    textMarker.content = "=";
    length -= 1;
  }
  const pairCount = length / 2;
  // Adjacent highlights serialize as `===={blue}`. The first pair closes the
  // previous color and the last opens the next; the color prefix also forces
  // opening because scanDelims sees `{` rather than the highlighted text.
  const splitBoundary = pairCount > 1;
  for (let index = 0; index < length; index += 2) {
    const pairIndex = index / 2;
    const isFirstPair = pairIndex === 0;
    const isLastPair = pairIndex === pairCount - 1;
    const ownsColorPrefix = color !== undefined && isLastPair;
    const textMarker = state.push("text", "", 0);
    textMarker.content = "==";
    if (ownsColorPrefix) textMarker.attrSet("data-highlight-color", color);
    const delimiterTokenIndex = state.tokens.length - 1;
    state.delimiters.push({
      marker,
      length: 0,
      ["token"]: delimiterTokenIndex,
      end: -1,
      open: splitBoundary ? isLastPair : ownsColorPrefix || canOpenPlain,
      close: splitBoundary ? isFirstPair : !ownsColorPrefix && canClosePlain,
    });
  }
  state.pos += scanned.length + (colorPrefix?.[0].length ?? 0);
  return true;
}

function processHighlightDelimiters(state: StateInline, delimiters: Delimiter[]): void {
  const loneMarkers: number[] = [];
  for (const startDelimiter of delimiters) {
    if (startDelimiter.marker !== 61 || startDelimiter.end === -1) continue;
    const endDelimiter = delimiters[startDelimiter.end];
    if (!endDelimiter) continue;
    const opening = state.tokens[startDelimiter.token];
    const closing = state.tokens[endDelimiter.token];
    if (!opening || !closing) continue;

    opening.type = "mark_open";
    opening.tag = "mark";
    opening.nesting = 1;
    opening.markup = "==";
    opening.content = "";
    closing.type = "mark_close";
    closing.tag = "mark";
    closing.nesting = -1;
    closing.markup = "==";
    closing.content = "";
    const previous = state.tokens[endDelimiter.token - 1];
    if (previous?.type === "text" && previous.content === "=") {
      loneMarkers.push(endDelimiter.token - 1);
    }
  }

  while (loneMarkers.length) {
    const index = loneMarkers.pop()!;
    let closingIndex = index + 1;
    while (state.tokens[closingIndex]?.type === "mark_close") closingIndex += 1;
    closingIndex -= 1;
    if (index === closingIndex) continue;
    const marker = state.tokens[index];
    const closing = state.tokens[closingIndex];
    if (!marker || !closing) continue;
    state.tokens[index] = closing;
    state.tokens[closingIndex] = marker;
  }
}

function highlightPostProcess(state: StateInline): void {
  processHighlightDelimiters(state, state.delimiters);
  for (const metadata of state.tokens_meta) {
    if (metadata?.delimiters) processHighlightDelimiters(state, metadata.delimiters);
  }
}

function highlightPlugin(markdown: MarkdownItInstance): void {
  markdown.inline.ruler.before("emphasis", "highlight", highlightTokenize);
  markdown.inline.ruler2.before("fragments_join", "highlight", highlightPostProcess);
}

// Start with text and paragraphs. Formats outside the toolbar must never
// become tokens that can change, discard, or downgrade surrounding content.
const renderer = new MarkdownIt("zero", {
  html: false,
  breaks: true,
  linkify: false,
  typographer: false,
})
  .enable(["list", "newline", "escape", "emphasis", "strikethrough"])
  .use(highlightPlugin)
  .use(taskLists, { enabled: true, label: false });

// Explicit paragraphs keep renderer separator newlines out of list text,
// while preserving the user's spaces and actual line breaks.
renderer.renderer.rules.paragraph_open = () => "<p>";
renderer.renderer.rules.paragraph_close = () => "</p>\n";
renderer.renderer.rules.softbreak = () => "<br>";
renderer.renderer.rules.hardbreak = () => "<br>";

// The task plugin retains the space after "[ ]" as label text. Remove only
// that syntax separator before the DOM parser preserves the user's spacing.
renderer.core.ruler.push("note_task_spacing", (state) => {
  for (const token of state.tokens) {
    const checkbox = token.children?.[0];
    const label = token.children?.[1];
    if (checkbox?.type === "html_inline" && checkbox.content.includes("task-list-item-checkbox")
      && label?.type === "text") {
      label.content = label.content.replace(/^ /, "");
    }
  }
});

renderer.block.ruler.before("paragraph", "note_heading", (state, startLine, _endLine, silent) => {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const end = state.eMarks[startLine]!;
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  if (state.src[start] !== "#" || (start + 1 < end && !/[ \t]/.test(state.src[start + 1]!))) {
    return false;
  }
  if (silent) return true;
  state.line = startLine + 1;
  const opening = state.push("heading_open", "h1", 1);
  opening.markup = "#";
  opening.map = [startLine, state.line];
  const inline = state.push("inline", "", 0);
  inline.content = state.src.slice(start + 1, end)
    .replace(/[ \t]+#+[ \t]*$/, "").trim();
  inline.map = [startLine, state.line];
  inline.children = [];
  state.push("heading_close", "h1", -1).markup = "#";
  return true;
}, { alt: ["paragraph"] });

interface MarkdownEnvironment extends Env {
  commentPrefix: string;
  comments: string[];
}

function protectComments(markdown: string): { markdown: string; env: MarkdownEnvironment } {
  let commentPrefix = "<!--BITTY_COMMENT_";
  while (markdown.includes(commentPrefix)) commentPrefix += "_";
  const comments: string[] = [];
  // Protect the whole supported comment before block parsing, so blank lines
  // and Markdown inside a comment cannot affect the surrounding document.
  const protectedMarkdown = markdown.replace(/<!--[\s\S]*?-->/g, (comment, offset: number) => {
    let backslashes = 0;
    for (let index = offset - 1; index >= 0 && markdown[index] === "\\"; index -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2) return comment;
    // Only standalone structural markers are metadata. Protect ordinary
    // comments first so marker examples inside them keep their original source.
    const linePrefix = markdown.slice(markdown.lastIndexOf("\n", offset - 1) + 1, offset);
    if (comment === FOLDED_MARKER
      && /^[ \t]*(?:#[ \t]+|(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)$/.test(linePrefix)) {
      return comment;
    }
    if (comment === EMPTY_PARAGRAPH_MARKER
      && /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?$/.test(linePrefix)
      && /^[ \t]*(?:\n|$)/.test(markdown.slice(offset + comment.length))) {
      return comment;
    }
    return `${commentPrefix}${comments.push(comment) - 1}-->`;
  });
  return { markdown: protectedMarkdown, env: { commentPrefix, comments } };
}

function commentAt(source: string, position: number, env: MarkdownEnvironment) {
  if (!source.startsWith(env.commentPrefix, position)) return null;
  const index = source.slice(position + env.commentPrefix.length).match(/^(\d+)-->/);
  if (!index) return null;
  const comment = env.comments[Number(index[1])];
  if (comment === undefined) return null;
  return {
    source: comment,
    length: env.commentPrefix.length + index[0].length,
  };
}

renderer.inline.ruler.before("text", "note_comment", (state, silent) => {
  const comment = commentAt(state.src, state.pos, state.env as MarkdownEnvironment);
  if (!comment) return false;
  if (!silent) state.push("html_comment", "", 0).content = comment.source;
  state.pos += comment.length;
  return true;
});

renderer.block.ruler.before("paragraph", "note_comment", (
  state: StateBlock, startLine, _endLine, silent,
) => {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!;
  const comment = commentAt(state.src, start, state.env as MarkdownEnvironment);
  if (!comment || state.src.slice(start + comment.length, state.eMarks[startLine]).trim()) {
    return false;
  }
  if (silent) return true;
  state.line = startLine + 1;
  const commentBlock = state.push("html_comment_block", "", 0);
  commentBlock.content = comment.source;
  commentBlock.map = [startLine, state.line];
  return true;
}, { alt: ["paragraph"] });

for (const [type, tag] of [["html_comment", "span"], ["html_comment_block", "div"]] as const) {
  renderer.renderer.rules[type] = (tokens, index) =>
    `<${tag} data-html-comment="${renderer.utils.escapeHtml(tokens[index]!.content)}" hidden></${tag}>`;
}

function escapeNoteText(text: string, startOfLine: boolean): string {
  return text.split("\n").map((line, index) => {
    // Escape only syntax this editor recognizes. Links, backticks and HTML
    // tags stay literal; escaped comments/highlights must stay literal too.
    let escaped = line.replace(/[\\*_~]/g, (marker, offset: number) =>
      marker === "_" && /\w/.test(line[offset - 1] ?? "") && /\w/.test(line[offset + 1] ?? "")
        ? marker : `\\${marker}`,
    ).replace(/<!--/g, "\\<!--")
      .replace(/={2,}(?=\{(?:red|yellow|blue|green)\}|[^\s{=])/g, (markers) =>
        markers.replace(/=/g, "\\="),
      );
    if (startOfLine || index > 0) {
      escaped = escaped.replace(/^([ \t]*)(#(?=[ \t]|$)|[-+](?=[ \t]|$))/, "$1\\$2")
        .replace(/^([ \t]*\d+)([.)])(?=[ \t]|$)/, "$1\\$2")
        .replace(/^\[([ xX])\](?=[ \t])/, "\\[$1]");
    }
    return escaped;
  }).join("\n");
}

const serializer = new MarkdownSerializer(
  {
    paragraph(state, node) {
      if (node.content.size) state.renderInline(node);
      else state.text(EMPTY_PARAGRAPH_MARKER, false);
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write("# ");
      if (node.attrs.collapsed) state.write(`${FOLDED_MARKER} `);
      state.renderInline(node);
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, "    ", (index) => {
        const checked = node.child(index).attrs.checked;
        return typeof checked === "boolean" ? `- [${checked ? "x" : " "}] ` : "- ";
      });
    },
    ordered_list(state, node) {
      const start = Number(node.attrs.order ?? 1);
      const maxWidth = String(start + node.childCount - 1).length;
      state.renderList(node, " ".repeat(maxWidth + 2), (index) => {
        const value = String(start + index);
        return `${" ".repeat(maxWidth - value.length)}${value}. `;
      });
    },
    list_item(state, node) {
      if (node.attrs.collapsed) state.write(`${FOLDED_MARKER} `);
      state.renderContent(node);
    },
    html_comment_block(state, node) {
      state.text(String(node.attrs.source), false);
      state.closeBlock(node);
    },
    html_comment(state, node) {
      state.text(String(node.attrs.source), false);
    },
    hard_break(state) {
      state.write("\n");
    },
    text(state, node, parent, index) {
      const startOfLine = index === 0 || parent.child(index - 1).type === noteSchema.nodes.hard_break;
      state.text(escapeNoteText(node.text ?? "", startOfLine), false);
    },
  },
  {
    em: {
      open: "*",
      close: "*",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    strong: {
      open: "**",
      close: "**",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    strike: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    highlight: {
      open: (_state, mark) => mark.attrs.color === DEFAULT_HIGHLIGHT_COLOR
        ? "=="
        : `=={${String(mark.attrs.color)}}`,
      close: "==",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
  { strict: true },
);

export type MarkdownParseResult =
  | { mode: "wysiwyg"; doc: ProseMirrorNode; markdown: string }
  | { mode: "raw"; reason: string; markdown: string };

function normalizeNewlines(markdown: string): string {
  return markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function protectFoldedMarkers(markdown: string): string {
  return markdown.replace(FOLDED_MARKER_PATTERN, `$1${FOLDED_SENTINEL}`);
}

function withoutFinalNewlines(markdown: string): string {
  return markdown.replace(/\n+$/, "");
}

function topLevelSourceBlocks(markdown: string, env: MarkdownEnvironment): Array<string | null> {
  const lines = markdown.split("\n");
  const ranges = renderer.parse(markdown, env)
    .filter((token) => token.level === 0 && token.map)
    .map((token) => ({ range: token.map as [number, number], type: token.type }));
  const uniqueRanges = ranges.filter(({ range: [start, end] }, index) =>
    index === 0
      || start !== ranges[index - 1]?.range[0]
      || end !== ranges[index - 1]?.range[1],
  );
  if (!uniqueRanges.length) {
    if (markdown.trim()) return [withoutFinalNewlines(markdown)];
    return Array.from({ length: Math.max(1, Math.floor(lines.length / 2)) }, () => null);
  }

  const blocks: Array<string | null> = [];
  let previousEnd = 0;
  uniqueRanges.forEach(({ range: [start, end], type }, index) => {
    const separatorLines = start - previousEnd;
    const blankParagraphs = index === 0
      ? Math.floor(separatorLines / 2)
      : Math.floor(Math.max(0, separatorLines - 1) / 2);
    for (let count = 0; count < blankParagraphs; count += 1) blocks.push(null);
    const source = lines.slice(start, end).join("\n");
    if (type === "bullet_list_open" || type === "ordered_list_open") {
      for (const part of source.split(/(\n{4,})/)) {
        if (!part) continue;
        if (/^\n{4,}$/.test(part)) {
          const blankParagraphsInListGap = Math.max(1, Math.floor(part.length / 2) - 1);
          for (let count = 0; count < blankParagraphsInListGap; count += 1) blocks.push(null);
        } else {
          blocks.push(part);
        }
      }
    } else {
      blocks.push(source);
    }
    previousEnd = end;
  });

  const trailingLines = lines.length - previousEnd;
  const trailingBlankParagraphs = Math.floor(Math.max(0, trailingLines - 1) / 2);
  for (let count = 0; count < trailingBlankParagraphs; count += 1) blocks.push(null);
  return blocks;
}

function parseRenderedBlock(markdown: string, env: MarkdownEnvironment): ProseMirrorNode[] {
  const container = document.createElement("div");
  container.innerHTML = renderer.render(
    markdown,
    env,
  );
  const parsed = ProseMirrorDOMParser.fromSchema(noteSchema).parse(container, { preserveWhitespace: true });
  const restoreMetadata = (node: ProseMirrorNode): ProseMirrorNode => {
    if (
      node.type === noteSchema.nodes.paragraph
      && node.textContent === EMPTY_PARAGRAPH_SENTINEL
    ) {
      return noteSchema.nodes.paragraph.create(node.attrs);
    }
    if (
      node.type === noteSchema.nodes.heading
      && node.textContent.startsWith(FOLDED_SENTINEL)
    ) {
      return node.type.create(
        { ...node.attrs, collapsed: true },
        node.content.cut(FOLDED_SENTINEL.length),
        node.marks,
      );
    }
    if (!node.childCount) return node;
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(restoreMetadata(child)));
    if (
      node.type === noteSchema.nodes.list_item
      && children[0]?.textContent.startsWith(FOLDED_SENTINEL)
    ) {
      const paragraph = children[0]!;
      children[0] = paragraph.copy(paragraph.content.cut(FOLDED_SENTINEL.length));
      return node.type.create(
        { ...node.attrs, collapsed: true },
        Fragment.fromArray(children),
        node.marks,
      );
    }
    return node.copy(Fragment.fromArray(children));
  };
  const nodes: ProseMirrorNode[] = [];
  parsed.forEach((node) => nodes.push(restoreMetadata(node)));
  return nodes;
}

function removeEmptyCollapsedStates(doc: ProseMirrorNode): ProseMirrorNode {
  const normalizeNode = (node: ProseMirrorNode): ProseMirrorNode => {
    if (!node.childCount) return node;
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(normalizeNode(child)));
    const collapsed = node.type === noteSchema.nodes.list_item
      && node.attrs.collapsed
      && children.length <= 1
      ? false
      : node.attrs.collapsed;
    return node.type.create(
      collapsed === node.attrs.collapsed ? node.attrs : { ...node.attrs, collapsed },
      Fragment.fromArray(children),
      node.marks,
    );
  };
  const children: ProseMirrorNode[] = [];
  doc.forEach((child) => children.push(normalizeNode(child)));
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]!;
    if (
      node.type === noteSchema.nodes.heading
      && node.attrs.collapsed
      && (index === children.length - 1
        || children[index + 1]?.type === noteSchema.nodes.heading)
    ) {
      children[index] = node.type.create(
        { ...node.attrs, collapsed: false },
        node.content,
        node.marks,
      );
    }
  }
  return doc.copy(Fragment.fromArray(children));
}

export function serializeMarkdown(doc: ProseMirrorNode): string {
  const markdown = serializer.serialize(doc, { tightLists: true });
  return markdown && !markdown.endsWith("\n") ? `${markdown}\n` : markdown;
}

export function parseMarkdown(source: string): MarkdownParseResult {
  const protectedSource = protectComments(normalizeNewlines(source));
  const env = protectedSource.env;
  const markdown = protectFoldedMarkers(protectedSource.markdown).replace(
    /^([ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?)<!-- bitty-empty-line -->[ \t]*$/gm,
    "$1" + EMPTY_PARAGRAPH_SENTINEL,
  );
  if (!markdown) {
    return {
      mode: "wysiwyg",
      doc: noteSchema.topNodeType.createAndFill()!,
      markdown: "",
    };
  }

  const nodes: ProseMirrorNode[] = [];
  for (const block of topLevelSourceBlocks(markdown, env)) {
    if (block === null) {
      nodes.push(noteSchema.nodes.paragraph.create());
      continue;
    }
    nodes.push(...parseRenderedBlock(block, env));
  }
  // ProseMirror uses AllSelection when no editable textblock exists. Keep a
  // place to type so a comment-only note does not lose its comments on input.
  if (nodes.length && nodes.every((node) => node.type === noteSchema.nodes.html_comment_block)) {
    nodes.push(noteSchema.nodes.paragraph.create());
  }
  const parsedDoc = noteSchema.topNodeType.createAndFill(null, nodes)
    ?? noteSchema.topNodeType.createAndFill()!;
  const doc = removeEmptyCollapsedStates(parsedDoc);
  return { mode: "wysiwyg", doc, markdown: serializeMarkdown(doc) };
}

export function parseSupportedFragment(markdown: string): ProseMirrorNode | null {
  const parsed = parseMarkdown(markdown);
  return parsed.mode === "wysiwyg" ? parsed.doc : null;
}
