import { Schema, type DOMOutputSpec, type NodeSpec } from "prosemirror-model";

const listItem: NodeSpec = {
  attrs: { checked: { default: null } },
  content: "paragraph block*",
  defining: true,
  parseDOM: [
    {
      tag: "li.task-list-item",
      getAttrs: (dom) => ({
        checked: Boolean((dom as HTMLElement).querySelector("input")?.checked),
      }),
    },
    { tag: "li", getAttrs: () => ({ checked: null }) },
  ],
  toDOM(node): DOMOutputSpec {
    if (typeof node.attrs.checked !== "boolean") return ["li", 0];
    return [
      "li",
      {
        class: `task-list-item${node.attrs.checked ? " is-checked" : ""}`,
        "data-checked": String(node.attrs.checked),
      },
      [
        "span",
        { class: "task-check", contenteditable: "false" },
        [
          "input",
          {
            type: "checkbox",
            checked: node.attrs.checked ? "checked" : undefined,
            "data-task-checkbox": "true",
            tabindex: "-1",
          },
        ],
      ],
      ["div", { class: "task-content" }, 0],
    ];
  },
};

export const noteSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "h1", attrs: { level: 1 } }],
      toDOM: () => ["h1", 0],
    },
    ordered_list: {
      attrs: { order: { default: 1 } },
      content: "list_item+",
      group: "block",
      parseDOM: [
        {
          tag: "ol",
          getAttrs: (dom) => ({
            order: Number((dom as HTMLElement).getAttribute("start") ?? 1),
          }),
        },
      ],
      toDOM: (node) => [
        "ol",
        {
          start: node.attrs.order === 1 ? undefined : node.attrs.order,
          style: `--list-start: ${node.attrs.order - 1}`,
        },
        0,
      ],
    },
    bullet_list: {
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", 0],
    },
    list_item: listItem,
    raw_block: {
      content: "text*",
      group: "block",
      marks: "",
      parseDOM: [{ tag: "div[data-raw-markdown]" }],
      toDOM: () => ["div", { class: "raw-markdown-block", "data-raw-markdown": "true" }, 0],
    },
    text: { group: "inline" },
  },
  marks: {
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM: () => ["s", 0],
    },
  },
});
