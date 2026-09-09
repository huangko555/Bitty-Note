---
name: bitty-note
description: Record user-provided notes and tasks in local Bitty Note; also edit, search, archive, and restore records.
---

# Bitty Note

## Fast path

Use available local file tools; assume no particular shell, runtime, or bundled script.

When asked to “record” something, write the supplied information into Bitty Note; do not perform, research, or plan the recorded subject unless separately requested. Treat future actions as central tasks and informational content as normal records; ask only when the distinction cannot be inferred and changes the result.

For a straightforward create, add, or checkbox change, send one brief progress update describing only the Bitty Note operation before file access, then the final result. Add another update only if blocked or the operation exceeds 60 seconds.

1. Resolve `save_dir` once at the start of an uninterrupted request. Combine location, discovery, and target reading in one local operation when practical. For a central task, enumerate active filenames and read only task-list candidates.
2. Identify one exact record, project, or item; ask when ambiguous.
3. For an existing record, read its latest disk content and immediately make the smallest requested edit. Conversation memory and earlier reads are never write baselines.
4. After a user turn, lengthy operation, or other interruption, resolve the directory and read the target again.
5. For routine writes, use a method that reports a diff, updated content, or created path. This output is the verification and completes the request; report the affected filename and result immediately. An error or missing result returns the workflow to step 3. For creation, use a non-overwriting operation; discovery is the existence check.

## Storage

Read `%LOCALAPPDATA%\DesktopNotes\config.json` and use `save_dir`. If absent, resolve the Windows Documents known folder and append `Bitty-Note`; never change the configuration.

- `<save_dir>\*.md`: active records.
- `<save_dir>\Archive\*.md`: archived records.
- Process regular direct files only; exclude symbolic links and other subdirectories.
- Search active records by default; include `Archive` only when requested or when the request is historical.

Archive and restore by moving between these locations. Never overwrite; deduplicate names case-insensitively with ` (2)`, ` (3)`, etc. Use valid Windows `.md` basenames with stems up to 100 characters and reject path components.

Content is UTF-8. Refuse to overwrite invalid UTF-8; preserve an existing BOM and CRLF/LF style. End new non-empty content with one newline.

## Front matter

A complete `---` block at the start of a record is metadata, not note content. Treat an opening `---` without a closing delimiter as ordinary Markdown.

- `bitty-background` stores the note background. Supported values are `default`, `sand`, `peach`, `rose`, `lavender`, `sky`, `mint`, and `gray`; absence means `default`.
- For ordinary creation or body edits—including organizing, rewriting, task matching, and search—operate only on the body after the closing delimiter. Preserve an existing front matter block byte-for-byte, including unknown fields, order, comments, quoting, spacing, delimiters, and adjacent blank lines. New records have no front matter unless the user requests metadata or a background.
- Change front matter only when the user explicitly requests that metadata change. Modify only the requested field; preserve all other front matter and its formatting. For a background change, update or add only `bitty-background`; selecting `default` removes that field, and removes the delimiters only when no metadata remains.

## General rules

Use the language of the user's current request for new filenames, headings, and content, independent of the app language. Preserve existing wording unless asked to change it.

Extend existing structure, preserve unrelated content, and treat an already-satisfied request as a successful no-op. New records need a concise filename and matching first-level heading.

Create, edit, check, uncheck, archive, or restore only within the user's request. Ask before permanent deletion, whole-record replacement, or archiving the central task list.

Dates are text; Bitty Note does not schedule notifications. Distinguish dated tasks from real reminders.

Report the affected filename and result. For searches, say whether archived records were included.

## Central task list

Keep one active task-list record. First find an existing filename meaning “Todo List”; canonical names include `待办清单.md` and `Todo List.md`. Reuse it across language changes, ask if several match, and create a current-language name only when none exists.

- `# Project` starts a project; `- [ ]` is incomplete and `- [x]` is complete.
- Put unclassified tasks under an existing heading meaning “Other Tasks,” such as `# 其他任务` or `# Other Tasks`; create one only when needed.
- Existing files are user-owned; never replace them with a template or normalize them.

New task-list structure:

```markdown
# <project or other-tasks label>

- [ ] <task>
```

Write real content, never placeholders or empty sections. If the first task names a project, use it directly.

- Match projects by visible `#` text and tasks by project plus visible task text; ignore formatting and reserved comments. Ask when ambiguous.
- Append before the next `#`; add a missing project at the end.
- Split independent actions and nest only explicit parent-child relationships. Parent and child completion are independent.
- Do not duplicate an exact incomplete task. A completed task may recur; “reopen” changes it to `[ ]`.
- Status changes alter only `[ ]`/`[x]`. Preserve wording, order, indentation, fold state, children, and surrounding content; keep completed tasks unless asked otherwise.

For “what remains,” return unchecked tasks grouped by project. Include completed or archived tasks only when requested. Dates, owners, priorities, and reminders are user-supplied plain text; invent no metadata or notification.

## Markdown

Use this structured subset for new content:

```markdown
# Record title

Text with **bold**, *italic*, ~~strikethrough~~ and ==green highlight==.

=={red}red== =={yellow}yellow== =={blue}blue==

- Unordered item
1. Ordered step
- [ ] Incomplete task
- [x] Completed task
```

- Only `#` headings are structured. Start new records with one matching the filename topic; ignore a deduplication suffix such as `(2)`. Multiple `#` sections are allowed.
- Keep structured paragraphs on one source line and separate blocks with one blank source line.
- Green uses `==text==`; red, yellow, and blue use `=={color}text==`. Unknown colors stay literal.
- Lists may mix and nest. Use two spaces for new nesting, preserve existing indentation, and treat parent and child task states independently.

`<!-- bitty-empty-line -->` represents one real empty paragraph; a normal blank source line only separates blocks. `<!-- bitty-folded -->` follows a heading, list, or task marker and requires child content. Ignore these comments when matching visible text, preserve their positions, and change fold state only when asked.

Preserve unsupported Markdown as raw blocks. Introduce lower headings, links, images, code, tables, quotes, or soft line breaks only when requested.
