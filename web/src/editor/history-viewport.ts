import {
  isHistoryTransaction,
  redoDepth,
  undoDepth,
} from "prosemirror-history";
import { Plugin, PluginKey, Transaction, type EditorState } from "prosemirror-state";

export type HistoryViewportIntent = "reveal" | "preserve";

const HISTORY_VIEWPORT_INTENT_META = "historyViewportIntent";

interface HistoryViewportState {
  done: HistoryViewportIntent[];
  undone: HistoryViewportIntent[];
  applied: HistoryViewportIntent | null;
}

const historyViewportKey = new PluginKey<HistoryViewportState>("historyViewport");

function alignStack(
  stack: readonly HistoryViewportIntent[],
  depth: number,
): HistoryViewportIntent[] {
  if (depth <= 0) return [];
  if (stack.length >= depth) return stack.slice(stack.length - depth);
  return [
    ...Array<HistoryViewportIntent>(depth - stack.length).fill("reveal"),
    ...stack,
  ];
}

function transactionIntent(transaction: Transaction): HistoryViewportIntent {
  const explicit = transaction.getMeta(HISTORY_VIEWPORT_INTENT_META);
  if (explicit === "preserve" || explicit === "reveal") return explicit;
  const appended = transaction.getMeta("appendedTransaction");
  return appended instanceof Transaction ? transactionIntent(appended) : "reveal";
}

function mergeIntent(
  previous: HistoryViewportIntent,
  next: HistoryViewportIntent,
): HistoryViewportIntent {
  return previous === "reveal" || next === "reveal" ? "reveal" : "preserve";
}

export function preserveViewportInHistory(transaction: Transaction): Transaction {
  return transaction.setMeta(HISTORY_VIEWPORT_INTENT_META, "preserve");
}

export function historyViewportIntentPlugin(): Plugin<HistoryViewportState> {
  return new Plugin<HistoryViewportState>({
    key: historyViewportKey,
    state: {
      init: (): HistoryViewportState => ({ done: [], undone: [], applied: null }),
      apply: (transaction, value, oldState, newState) => {
        const previousDoneDepth = undoDepth(oldState);
        const nextDoneDepth = undoDepth(newState);
        const previousUndoneDepth = redoDepth(oldState);
        const nextUndoneDepth = redoDepth(newState);
        const done = alignStack(value.done, previousDoneDepth);
        const undone = alignStack(value.undone, previousUndoneDepth);

        if (isHistoryTransaction(transaction)) {
          if (nextDoneDepth < previousDoneDepth) {
            const applied = done.at(-1) ?? "reveal";
            return {
              done: alignStack(done.slice(0, -1), nextDoneDepth),
              undone: alignStack([...undone, applied], nextUndoneDepth),
              applied,
            };
          }
          if (nextUndoneDepth < previousUndoneDepth) {
            const applied = undone.at(-1) ?? "reveal";
            return {
              done: alignStack([...done, applied], nextDoneDepth),
              undone: alignStack(undone.slice(0, -1), nextUndoneDepth),
              applied,
            };
          }
          return { done, undone, applied: null };
        }

        let nextDone = alignStack(done, nextDoneDepth);
        if (
          transaction.docChanged
          && transaction.getMeta("addToHistory") !== false
          && nextDoneDepth > 0
        ) {
          const intent = transactionIntent(transaction);
          if (nextDoneDepth > previousDoneDepth) {
            nextDone = alignStack([...done, intent], nextDoneDepth);
          } else if (nextDoneDepth === previousDoneDepth) {
            const previous = nextDone.at(-1) ?? "reveal";
            nextDone[nextDone.length - 1] = mergeIntent(previous, intent);
          }
        }

        return {
          done: nextDone,
          undone: alignStack(undone, nextUndoneDepth),
          applied: null,
        };
      },
    },
  });
}

export function appliedHistoryViewportIntent(
  state: EditorState,
): HistoryViewportIntent | null {
  return historyViewportKey.getState(state)?.applied ?? null;
}

export function transactionPreservesViewport(transaction: Transaction): boolean {
  return transactionIntent(transaction) === "preserve";
}
