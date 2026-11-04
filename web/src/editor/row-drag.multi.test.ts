import { history, undo, redo } from "prosemirror-history";
import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { deleteRows, moveRows, rowDragPlugin, selectedDragRows } from "./row-drag";
import { noteSchema as s } from "./schema";

const p = (text: string) => s.nodes.paragraph.create(null, text ? s.text(text) : undefined);
const item = (text: string, children: ReturnType<typeof p>[] = [], checked: boolean | null = null) =>
  s.nodes.list_item.create({ checked }, [p(text), ...children]);
const list = (...items: ReturnType<typeof p>[]) => s.nodes.bullet_list.create(null, items);
const heading = (text: string) => s.nodes.heading.create({ level: 1, collapsed: true }, s.text(text));
const doc = (...nodes: ReturnType<typeof p>[]) => s.nodes.doc.create(null, nodes);
function pos(root: ReturnType<typeof p>, text: string): number {
  let found = -1;
  root.descendants((node, position, parent) => {
    if (found >= 0) return false;
    if ((node.type === s.nodes.list_item && node.firstChild?.textContent === text)
      || (parent === root && node.isTextblock && node.textContent === text)) {
      found = position;
      return false;
    }
  });
  if (found < 0) throw new Error(text);
  return found;
}
function stateFor(root: ReturnType<typeof p>, start: string, end: string) {
  const textStart = (text: string) => pos(root, text) + (root.nodeAt(pos(root, text))!.type === s.nodes.list_item ? 2 : 1);
  return EditorState.create({
    doc: root,
    selection: TextSelection.create(root, textStart(start), textStart(end) + end.length),
    plugins: [history(), rowDragPlugin()],
  });
}

describe("multiple row dragging", () => {
  it("resolves partial, reversed selections and excludes a row starting at the end boundary", () => {
    const root = doc(p("alpha"), p("beta"), p("gamma"));
    const state = EditorState.create({ doc: root, selection: TextSelection.create(root, pos(root, "gamma") + 1, 3) });
    expect(selectedDragRows(state, pos(root, "beta"))).toEqual([0, pos(root, "beta")]);
    expect(selectedDragRows(state, pos(root, "gamma"))).toEqual([pos(root, "gamma")]);
  });

  it("includes intervening blank rows and deduplicates parents and their descendants", () => {
    const root = doc(list(item("parent", [list(item("child"))]), item("last")), p(""), p("end"));
    const state = stateFor(root, "parent", "end");
    expect(selectedDragRows(state, pos(root, "child"))).toEqual([
      pos(root, "parent"), pos(root, "last"), pos(root, ""), pos(root, "end"),
    ]);
    const childrenOnly = stateFor(root, "child", "last");
    expect(selectedDragRows(childrenOnly, pos(root, "child"))).toEqual([pos(root, "child"), pos(root, "last")]);
  });

  it.each(["before", "after", "end"] as const)("moves rows together to %s and preserves selection and history", (side) => {
    const root = doc(p("A"), p("B"), p("C"), p("D"));
    let state = stateFor(root, "B", "C");
    const dispatch = (tr: Parameters<typeof state.apply>[0]) => { state = state.apply(tr); };
    expect(moveRows(state, dispatch, selectedDragRows(state, pos(root, "C")), side === "end" ? null : pos(root, side === "before" ? "A" : "D"), side === "end" ? "after" : side)).toBe(true);
    expect(state.doc.textContent).toBe(side === "before" ? "BCAD" : "ADBC");
    expect(state.selection.$from.parent.textContent).toBe("B");
    expect(state.selection.$to.parent.textContent).toBe("C");
    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.eq(root)).toBe(true);
    expect(redo(state, dispatch)).toBe(true);
    state.doc.check();
  });

  it("deletes a selection once including its hidden subtree and restores it with one undo", () => {
    const root = doc(list(item("parent", [list(item("child"))]), item("next")), p("keep"));
    let state = stateFor(root, "parent", "next");
    const dispatch = (tr: Parameters<typeof state.apply>[0]) => { state = state.apply(tr); };
    expect(deleteRows(state, dispatch, selectedDragRows(state, pos(root, "next")))).toBe(true);
    expect(state.doc.textContent).toBe("keep");
    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.eq(root)).toBe(true);
    expect(undo(state, dispatch)).toBe(false);
  });

  it("leaves a valid empty paragraph after deleting everything", () => {
    const root = doc(p("A"), p("B"));
    let state = stateFor(root, "A", "B");
    deleteRows(state, tr => { state = state.apply(tr); }, selectedDragRows(state, 0));
    expect(state.doc.eq(doc(p("")))).toBe(true);
    state.doc.check();
  });

  it("moves nested siblings out together while retaining their parent", () => {
    const root = doc(list(item("parent", [list(item("A"), item("B"))]), item("C")));
    let state = stateFor(root, "A", "B");
    expect(moveRows(state, tr => { state = state.apply(tr); }, selectedDragRows(state, pos(root, "A")), pos(root, "parent"), "after")).toBe(true);
    expect(state.doc.eq(doc(list(item("parent"), item("A"), item("B"), item("C"))))).toBe(true);
    state.doc.check();
  });

  it("moves a mixed group inside a list using the target type and retains children", () => {
    const root = doc(p("A"), list(item("B", [list(item("child"))])), list(item("target", [], true)));
    let state = stateFor(root, "A", "B");
    expect(moveRows(state, tr => { state = state.apply(tr); }, selectedDragRows(state, 0), pos(root, "target"), "inside")).toBe(true);
    const target = state.doc.firstChild!.firstChild!;
    expect(target.child(1).childCount).toBe(2);
    expect(target.child(1).firstChild!.attrs.checked).toBe(false);
    expect(target.child(1).lastChild!.textContent).toBe("Bchild");
    state.doc.check();
  });

  it("moves headings with their complete sections, deduplicating selected section content", () => {
    const root = doc(heading("H1"), p("A"), heading("H2"), p("B"), heading("H3"), p("C"));
    let state = stateFor(root, "H1", "H2");
    const sources = selectedDragRows(state, pos(root, "H2"));
    expect(sources).toEqual([0, pos(root, "H2")]);
    expect(moveRows(state, tr => { state = state.apply(tr); }, sources, pos(root, "C"), "after")).toBe(true);
    expect(state.doc.textContent).toBe("H3CH1AH2B");
    expect(state.doc.child(2).attrs.collapsed).toBe(true);
    state.doc.check();
  });

  it("retains checked states, inline marks and nested content when reordering task siblings", () => {
    const marked = s.nodes.list_item.create({ checked: true }, [
      s.nodes.paragraph.create(null, s.text("A", [s.marks.strong.create()])),
      list(item("child", [], false)),
    ]);
    const root = doc(list(marked, item("B", [], false), item("C", [], true)));
    let state = stateFor(root, "A", "B");
    moveRows(state, tr => { state = state.apply(tr); }, selectedDragRows(state, pos(root, "B")), pos(root, "C"), "after");
    expect(state.doc.eq(doc(list(item("C", [], true), marked, item("B", [], false))))).toBe(true);
    state.doc.check();
  });

  it("rejects dropping anywhere inside the group or its descendants and ignores no-op moves", () => {
    const root = doc(list(item("A", [list(item("child"))]), item("B"), item("C")));
    const state = stateFor(root, "A", "B");
    const sources = selectedDragRows(state, pos(root, "B"));
    expect(moveRows(state, undefined, sources, pos(root, "child"), "inside")).toBe(false);
    expect(moveRows(state, undefined, sources, pos(root, "B"), "after")).toBe(false);
    expect(moveRows(state, undefined, sources, pos(root, "C"), "before")).toBe(false);
  });

  it("keeps typing before and after a group operation in separate undo steps", () => {
    let state = stateFor(doc(p("A"), p("B"), p("C")), "A", "B");
    const dispatch = (tr: Parameters<typeof state.apply>[0]) => { state = state.apply(tr); };
    dispatch(state.tr.insertText("!", pos(state.doc, "C") + 2));
    const before = state.doc;
    moveRows(state, dispatch, [0, pos(state.doc, "B")], null);
    const moved = state.doc;
    dispatch(state.tr.insertText("x", state.doc.content.size - 1));
    undo(state, dispatch);
    expect(state.doc.eq(moved)).toBe(true);
    undo(state, dispatch);
    expect(state.doc.eq(before)).toBe(true);
    undo(state, dispatch);
    expect(state.doc.textContent).toBe("ABC");
  });
});
