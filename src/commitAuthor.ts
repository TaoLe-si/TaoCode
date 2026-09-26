// How IDEA renders a commit author, ported from VcsUserUtil.
//
// CommitAuthorComponent draws "By <link>" above the commit actions (CommitAuthorComponent
// .kt:124-137): the label is VcsBundle's `label.by.author` and the link text is
// VcsUserUtil.getShortPresentation — which is the *name*, falling back to the part of the
// e-mail before the '@' and then to the whole e-mail (VcsUserUtil.java:34-46). The link's
// tooltip is the full "Name <email>" form (:24-28).

export interface CommitAuthor {
  name: string
  email: string
}

/** VcsUserUtil.java:34-46 — the name, else the e-mail's local part, else the e-mail. */
export function shortName(author: CommitAuthor): string {
  if (author.name.trim()) return author.name.trim()
  return nameFromEmail(author.email) ?? author.email.trim()
}

/** VcsUserUtil.java:48-55 — everything before the '@' when there is one. */
export function nameFromEmail(email: string): string | null {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : null
}

/** VcsUserUtil.java:24-28 (getString) — the tooltip the link carries. */
export function fullName(author: CommitAuthor): string {
  const name = author.name.trim()
  const email = author.email.trim()
  if (!name) return email
  if (!email) return name
  return `${name} <${email}>`
}

/** Nothing to show (and the whole row stays hidden) without a name or an e-mail. */
export function hasAuthor(author: CommitAuthor | null | undefined): boolean {
  return Boolean(author && (author.name.trim() || author.email.trim()))
}

// --- VcsUserUtil.isSamePerson / getNameInStandardForm -------------------------------------
//
// `isDefaultAuthor` (GitCommitOptionsUi.kt:261-267) asks whether the entered author is the
// repository's own user, and it answers through isSamePerson, which compares the *display*
// names after a normalisation that lower-cases and re-joins two-word names with a single
// space. Without it, "ADA LOVELACE" / "Ada-Lovelace" would be recorded as an override (and
// would raise the "Author differs from default" warning) even though it is the same person.
// It deliberately does NOT reorder the words: "Lovelace,Ada" stays a different person.

// VcsUserUtil.java:18 — `(\w+)[\p{Punct}\s](\w+)`. `matches()` anchors both ends, so the
// separator is exactly one character. Java's `\w` is ASCII-only (no UNICODE_CHARACTER_CLASS),
// and `\p{Punct}` is the ASCII punctuation set — that is why the source itself says
// "synonyms detection is currently english-only" (:65). The class below spells both out the
// same way (`!-/`, `:-@`, `[-\``, `{-~` are the four ASCII punctuation ranges).
const NAME_PATTERN = /^(\w+)[!-/:-@[-`{-~\s](\w+)$/
// VcsUserUtil.java:15 — `[ -~]*`: only printable ASCII is safe to lower-case.
const PRINTABLE_ASCII = /^[ -~]*$/

/** VcsUserUtil.java:59-67 — lower-cased "first last" for two ASCII-word names, else the raw name. */
export function nameToStandardForm(name: string): string {
  const twoWords = NAME_PATTERN.exec(name)
  if (twoWords) return `${twoWords[1].toLowerCase()} ${twoWords[2].toLowerCase()}`
  return PRINTABLE_ASCII.test(name) ? name.toLowerCase() : name
}

/** VcsUserUtil.java:23-25 — same person when the display names agree in standard form. */
export function isSamePerson(one: CommitAuthor, other: CommitAuthor): boolean {
  return nameToStandardForm(shortName(one)) === nameToStandardForm(shortName(other))
}

/**
 * GitCommitOptionsUi.kt:261-267 — the author counts as "default" only when the repository
 * actually has a configured user (the source needs `userRegistry.getUser(root) != null`, and
 * readCurrentUser returns null when `user.name` is unset, GitUserRegistry.java:70-74) and the
 * entered author is that same person.
 */
export function isDefaultAuthor(author: CommitAuthor | null, repositoryAuthor: CommitAuthor | null): boolean {
  if (!author || !repositoryAuthor) return false
  if (!repositoryAuthor.name.trim()) return false
  return isSamePerson(author, repositoryAuthor)
}

/**
 * GitCommitOptionsUi.kt:205-213 — the author is kept as an override only when it is set and
 * differs from the default. Re-entering the default person in another word order therefore
 * drops the override instead of flagging it.
 */
export function extendsBeyondDefault(author: CommitAuthor | null, repositoryAuthor: CommitAuthor | null): boolean {
  return hasAuthor(author) && !isDefaultAuthor(author, repositoryAuthor)
}

/**
 * GitCommitOptionsUi.kt:259 — the completion list is the users known from the log plus the
 * authors saved from earlier commits (`GitVcsSettings.commitAuthors`), de-duplicated and
 * sorted. `toExactString` (VcsUserUtil.java:20-22) is the saved "Name <email>" form.
 */
export function knownAuthors(fromLog: readonly string[], saved: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const entry of [...fromLog, ...saved]) {
    const text = entry.trim()
    if (text) unique.add(text)
  }
  return [...unique].sort()
}

/**
 * VcsUserParser.parse (VcsUserParser.kt:12-23) — the "Name <email>" shape the log and the saved
 * authors use. The brackets only count at the very end (`closeBrace != user.length - 1`), and a
 * string without them is filed as a bare name, which is what `createUser(user, "")` does.
 *
 * VcsUserParser.correct (:25-48), which repairs a missing bracket pair ("Name name@mail.com"),
 * is not ported: it exists to clean up hand-typed input in IDEA's single text field, while
 * TaoCode's editor keeps the name and the e-mail in separate inputs, so there is nothing to
 * repair. `splitAuthorInput` still accepts a bracketed pair pasted into either input.
 */
export function parseAuthorEntry(entry: string): CommitAuthor {
  const text = entry.trim()
  const open = text.indexOf('<')
  const close = text.lastIndexOf('>')
  if (open < 0 || close !== text.length - 1) return { name: text, email: '' }
  return { name: text.slice(0, open).trim(), email: text.slice(open + 1, close).trim() }
}

/** The name half of a "Name <email>" entry (empty when the entry is a bare e-mail). */
export function authorNamePart(entry: string): string {
  return parseAuthorEntry(entry).name
}

/** The e-mail half of a "Name <email>" entry (empty for a bare name). */
export function authorEmailPart(entry: string): string {
  return parseAuthorEntry(entry).email
}

/**
 * The editor's two inputs stand in for IDEA's single VcsUserEditor field (VcsUserEditor.kt:14-19),
 * so a full "Name <email>" typed or pasted into either half is split by `parseAuthorEntry`;
 * otherwise both halves are taken as typed.
 */
export function splitAuthorInput(name: string, email: string): CommitAuthor {
  for (const candidate of [name, email]) {
    if (candidate.includes('<') && candidate.trim().endsWith('>')) return parseAuthorEntry(candidate)
  }
  return { name: name.trim(), email: email.trim() }
}
