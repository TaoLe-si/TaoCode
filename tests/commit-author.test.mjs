import test from 'node:test'
import assert from 'node:assert/strict'
import {
  authorEmailPart, authorNamePart, extendsBeyondDefault, fullName, hasAuthor, isDefaultAuthor,
  isSamePerson, knownAuthors, nameFromEmail, nameToStandardForm, parseAuthorEntry, shortName,
  splitAuthorInput,
} from '../src/commitAuthor.ts'

// VcsUserUtil.getShortPresentation is the *name* (VcsUserUtil.java:34-46), so a configured
// author shows as their name and not as their e-mail.
test('the link shows the author name when there is one', () => {
  assert.equal(shortName({ name: 'Ada Lovelace', email: 'ada@example.com' }), 'Ada Lovelace')
  assert.equal(shortName({ name: '  Ada  ', email: 'ada@example.com' }), 'Ada')
})

// getUserName falls back to the part of the address before the '@' (:41-46, :48-55).
test('without a name the e-mail local part stands in', () => {
  assert.equal(shortName({ name: '', email: 'ada@example.com' }), 'ada')
  assert.equal(shortName({ name: '   ', email: 'ada@example.com' }), 'ada')
  assert.equal(nameFromEmail('ada@example.com'), 'ada')
  assert.equal(nameFromEmail('@example.com'), null, 'an address with nothing before the @ has no local part')
  assert.equal(nameFromEmail('no-at-sign'), null)
})

test('an address with neither local part nor name shows the address itself', () => {
  assert.equal(shortName({ name: '', email: '@example.com' }), '@example.com')
  assert.equal(shortName({ name: '', email: 'no-at-sign' }), 'no-at-sign')
})

// getString (:24-28) is the tooltip the link carries.
test('the tooltip is the full "Name <email>" form', () => {
  assert.equal(fullName({ name: 'Ada', email: 'ada@example.com' }), 'Ada <ada@example.com>')
  assert.equal(fullName({ name: '', email: 'ada@example.com' }), 'ada@example.com')
  assert.equal(fullName({ name: 'Ada', email: '' }), 'Ada')
  assert.equal(fullName({ name: '', email: '' }), '')
})

test('the whole row stays hidden when the repository has no author configured', () => {
  assert.equal(hasAuthor({ name: '', email: '' }), false)
  assert.equal(hasAuthor({ name: '   ', email: '' }), false)
  assert.equal(hasAuthor(null), false)
  assert.equal(hasAuthor(undefined), false)
  assert.equal(hasAuthor({ name: 'Ada', email: '' }), true)
  assert.equal(hasAuthor({ name: '', email: 'ada@example.com' }), true)
})

// getNameInStandardForm (:59-67): a name made of exactly two ASCII word tokens is folded to
// "<first> <second>" in lower case, so the same person typed in any casing is one person.
test('two-word names are compared in standard form', () => {
  assert.equal(nameToStandardForm('Ada Lovelace'), 'ada lovelace')
  assert.equal(nameToStandardForm('Lovelace,Ada'), 'lovelace ada')
  assert.equal(nameToStandardForm('Ada\tLovelace'), 'ada lovelace', 'the separator may be any punctuation or space')
  assert.equal(nameToStandardForm('Ada-Lovelace'), 'ada lovelace')
  assert.equal(nameToStandardForm('ADA.LOVELACE'), 'ada lovelace')
})

// The three-words / non-ASCII cases fall through to nameToLowerCase (:66-67): the source
// spells out that the synonym detection is english-only (:65), and `\w` stays ASCII.
test('anything that is not a two-word ASCII name keeps its own shape', () => {
  assert.equal(nameToStandardForm('Ada  Lovelace'), 'ada  lovelace', 'two separators is not a match')
  assert.equal(nameToStandardForm('Ada Petra Lovelace'), 'ada petra lovelace')
  assert.equal(nameToStandardForm('Иван Иванов'), 'Иван Иванов', 'non-ASCII names are left untouched')
  assert.equal(nameToStandardForm('Ada'), 'ada')
})

// getUserName (:41-46) runs first, so a user with only an e-mail compares by the local part.
test('isSamePerson goes through the display name, not the raw fields', () => {
  assert.equal(isSamePerson({ name: 'Ada Lovelace', email: '' }, { name: 'ada lovelace', email: 'x@y.z' }), true,
    'case and the e-mail are both irrelevant')
  assert.equal(isSamePerson({ name: 'Ada Lovelace', email: '' }, { name: 'Lovelace,Ada', email: '' }), false,
    'the standard form lower-cases and re-joins, it does not reorder the two words')
  assert.equal(isSamePerson({ name: '', email: 'ada@example.com' }, { name: 'Ada', email: '' }), true,
    'the e-mail local part is the display name when the name is empty')
  assert.equal(isSamePerson({ name: 'Ada', email: '' }, { name: 'Grace', email: '' }), false)
})

// GitCommitOptionsUi.kt:261-267 needs a *configured* repository user before anything can be
// "default" (readCurrentUser returns null without user.name, GitUserRegistry.java:70-74).
test('the default author needs the repository to have a configured user', () => {
  const ada = { name: 'Ada Lovelace', email: 'ada@example.com' }
  assert.equal(isDefaultAuthor(ada, ada), true)
  assert.equal(isDefaultAuthor({ name: 'ada lovelace', email: 'other@example.com' }, ada), true,
    'the e-mail is not part of isSamePerson (:23-25)')
  assert.equal(isDefaultAuthor(ada, { name: '', email: 'ada@example.com' }), false, 'no configured user name')
  assert.equal(isDefaultAuthor(ada, null), false)
  assert.equal(isDefaultAuthor(null, ada), false)
  assert.equal(isDefaultAuthor({ name: 'Grace', email: 'g@example.com' }, ada), false)
})

// GitCommitOptionsUi.kt:205-213: null / default clears the field, so only a real difference
// is kept as an override.
test('only an author beyond the default is kept as an override', () => {
  const ada = { name: 'Ada Lovelace', email: 'ada@example.com' }
  assert.equal(extendsBeyondDefault(null, ada), false)
  assert.equal(extendsBeyondDefault(ada, ada), false, 're-entering the default person is not an override')
  assert.equal(extendsBeyondDefault({ name: 'ada lovelace', email: 'ada@example.com' }, ada), false)
  assert.equal(extendsBeyondDefault({ name: 'Grace Hopper', email: 'g@example.com' }, ada), true)
})

// getKnownCommitAuthors (:259): the users from the log plus the saved authors, de-duplicated
// and sorted, with blank entries dropped.
test('the completion list merges the log users with the saved authors', () => {
  assert.deepEqual(
    knownAuthors(['Ada Lovelace <ada@example.com>', 'grace@example.com'], ['Ada Lovelace <ada@example.com>', '  ', 'Bo <b@x.y>']),
    ['Ada Lovelace <ada@example.com>', 'Bo <b@x.y>', 'grace@example.com'],
  )
  assert.deepEqual(knownAuthors([], []), [])
})

// The saved form is toExactString (VcsUserUtil.java:20-22), which is what fullName returns.
test('a saved author round-trips through fullName', () => {
  const author = { name: 'Ada Lovelace', email: 'ada@example.com' }
  assert.deepEqual(knownAuthors([], [fullName(author)]), ['Ada Lovelace <ada@example.com>'])
})

// VcsUserParser.parse (:12-23): the brackets only count when the string ends with '>'.
test('a log entry splits into its name and e-mail halves', () => {
  assert.deepEqual(parseAuthorEntry('Ada Lovelace <ada@example.com>'), { name: 'Ada Lovelace', email: 'ada@example.com' })
  assert.deepEqual(parseAuthorEntry('  Ada  < ada@example.com > '), { name: 'Ada', email: 'ada@example.com' })
  assert.equal(authorNamePart('Ada <ada@example.com>'), 'Ada')
  assert.equal(authorEmailPart('Ada <ada@example.com>'), 'ada@example.com')
})

// `openBrace < 0 || closeBrace != user.length - 1` (:18) sends a bracket-less string to
// createUser(user, "") — a bare name with an empty e-mail, not a failed parse.
test('an entry without a trailing bracket pair is a bare name', () => {
  assert.deepEqual(parseAuthorEntry('grace@example.com'), { name: 'grace@example.com', email: '' })
  assert.equal(authorEmailPart('grace@example.com'), '')
  assert.deepEqual(parseAuthorEntry('Ada <ada@example.com> trailing'), { name: 'Ada <ada@example.com> trailing', email: '' })
})

// The two editor inputs stand in for IDEA's single field, so a full pair pasted into either
// half is split rather than kept verbatim.
test('a full "Name <email>" typed into either half is split', () => {
  assert.deepEqual(splitAuthorInput('Ada <ada@example.com>', ''), { name: 'Ada', email: 'ada@example.com' })
  assert.deepEqual(splitAuthorInput('', 'Ada <ada@example.com>'), { name: 'Ada', email: 'ada@example.com' })
  assert.deepEqual(splitAuthorInput('  Ada  ', ' ada@example.com '), { name: 'Ada', email: 'ada@example.com' })
  assert.deepEqual(splitAuthorInput('Ada', 'ada@example.com'), { name: 'Ada', email: 'ada@example.com' })
  assert.deepEqual(splitAuthorInput('', ''), { name: '', email: '' })
})
