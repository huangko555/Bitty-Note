declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";

  interface Options {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }

  const taskLists: (markdown: MarkdownIt, options?: Options) => void;
  export default taskLists;
}
