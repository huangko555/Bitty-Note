import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import {
  DOMParser as ProseMirrorDOMParser,
  Fragment,
  type Node as ProseMirrorNode,
} from "prosemirror-model";
import { MarkdownSerializer } from "prosemirror-markdown";

import { noteSchema } from "./schema";
import { t } from "../i18n";

const EMPTY_LIST_PARAGRAPH_MARKER = "<!-- bitty-empty-line -->";
const EMPTY_LIST_PARAGRAPH_SENTINEL = "BITTY_EMPTY_LIST_PARAGRAPH";

const inspector = new MarkdownIt("commonmark", {
  html: true,
  linkify: false,
  typographer: false,
}).enable("strikethrough");

const renderer = new MarkdownIt("commonmark", {
  html: false,
  linkify: false,
  typographer: false,
})
  .enable("strikethrough")
  .use(taskLists, { enabled: true, label: false });

const blockTokens = new Set([
  "paragraph_open",
  "paragraph_close",
  "heading_open",
  "heading_close",
  "bullet_list_open",
  "bullet_list_close",
  "ordered_list_open",
  "ordered_list_close",
  "list_item_open",
  "list_item_close",
  "inline",
]);

const inlineTokens = new Set([
  "text",
  "strong_open",
  "strong_close",
  "em_open",
  "em_close",
  "s_open",
  "s_close",
]);

const serializer = new MarkdownSerializer(
  {
    paragraph(state, node, parent) {
      if (node.content.size) state.renderInline(node);
      else if (parent.type === noteSchema.nodes.list_item) {
        state.text(EMPTY_LIST_PARAGRAPH_MARKER, false);
      }
      else state.write("\n");
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write("# ");
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
      state.renderContent(node);
    },
    raw_block(state, node) {
      state.write(node.textContent);
      state.closeBlock(node);
    },
    text(state, node) {
      state.text(node.text ?? "", true);
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
  },
  { strict: true },
);

export type MarkdownParseResult =
  | { mode: "wysiwyg"; doc: ProseMirrorNode; markdown: string }
  | { mode: "raw"; reason: string; markdown: string };

function normalizeNewlines(markdown: string): string {
  return markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function withoutFinalNewlines(markdown: string): string {
  return markdown.replace(/\n+$/, "");
}

function supportedSyntax(markdown: string): string | null {
  markdown = markdown.replaceAll(
    EMPTY_LIST_PARAGRAPH_MARKER,
    EMPTY_LIST_PARAGRAPH_SENTINEL,
  );
  if (/^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/m.test(markdown)) {
    return t("markdownTable");
  }

  const tokens = inspector.parse(markdown, {});
  for (const token of tokens) {
    if (!blockTokens.has(token.type)) return t("markdownUnsupportedBlock", { type: token.type });
    if (token.type === "heading_open" && token.tag !== "h1") return t("markdownLowerHeading");
    if (token.type === "inline") {
      for (const child of token.children ?? []) {
        if (!inlineTokens.has(child.type)) return t("markdownUnsupportedInline", { type: child.type });
      }
    }
  }
  return null;
}

function topLevelSourceBlocks(markdown: string): Array<string | null> {
  const lines = markdown.split("\n");
  const ranges = inspector.parse(markdown, {})
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

function parseRenderedBlock(markdown: string): ProseMirrorNode[] {
  const container = document.createElement("div");
  container.innerHTML = renderer.render(
    markdown.replaceAll(EMPTY_LIST_PARAGRAPH_MARKER, EMPTY_LIST_PARAGRAPH_SENTINEL),
  );
  const parsed = ProseMirrorDOMParser.fromSchema(noteSchema).parse(container);
  const restoreEmptyListParagraphs = (node: ProseMirrorNode): ProseMirrorNode => {
    if (
      node.type === noteSchema.nodes.paragraph
      && node.textContent === EMPTY_LIST_PARAGRAPH_SENTINEL
    ) {
      return noteSchema.nodes.paragraph.create(node.attrs);
    }
    if (!node.childCount) return node;
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(restoreEmptyListParagraphs(child)));
    return node.copy(Fragment.fromArray(children));
  };
  const nodes: ProseMirrorNode[] = [];
  parsed.forEach((node) => nodes.push(restoreEmptyListParagraphs(node)));
  return nodes;
}

export function serializeMarkdown(doc: ProseMirrorNode): string {
  const markdown = serializer.serialize(doc, { tightLists: true });
  return markdown && !markdown.endsWith("\n") ? `${markdown}\n` : markdown;
}

export function parseMarkdown(source: string): MarkdownParseResult {
  const markdown = normalizeNewlines(source);
  if (!markdown) {
    return {
      mode: "wysiwyg",
      doc: noteSchema.topNodeType.createAndFill()!,
      markdown: "",
    };
  }

  const nodes: ProseMirrorNode[] = [];
  for (const block of topLevelSourceBlocks(markdown)) {
    if (block === null) {
      nodes.push(noteSchema.nodes.paragraph.create());
      continue;
    }
    if (supportedSyntax(block)) {
      nodes.push(
        noteSchema.nodes.raw_block.create(
          null,
          block ? noteSchema.text(block) : undefined,
        ),
      );
    } else {
      nodes.push(...parseRenderedBlock(block));
    }
  }
  const doc = noteSchema.topNodeType.createAndFill(null, nodes)
    ?? noteSchema.topNodeType.createAndFill()!;
  return { mode: "wysiwyg", doc, markdown: serializeMarkdown(doc) };
}

export function parseSupportedFragment(markdown: string): ProseMirrorNode | null {
  const parsed = parseMarkdown(markdown);
  return parsed.mode === "wysiwyg" ? parsed.doc : null;
}
