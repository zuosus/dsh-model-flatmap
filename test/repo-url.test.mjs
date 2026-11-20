/**
 * Tests for the panel's "marketplace link" button.
 *
 * The button promotes the dsh.zuos.us plugin marketplace — a fixed public site,
 * not a property derived from the local checkout. These tests pin the one thing
 * that makes the link honest:
 *
 * 1. **The destination is the documented marketplace address.** It is declared
 *    once in `repo-url.js` and repeated in `client.js`; a test keeps the two in
 *    agreement so the browser half cannot drift from the declared address.
 * 2. **A git remote no longer decides the destination.** The button does not
 *    shell out to git, does not register a Host route, and always opens the
 *    marketplace regardless of what remotes the checkout configures.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { MARKETPLACE_URL } from '../repo-url.js'

const here = dirname(fileURLToPath(import.meta.url))

test('the marketplace link points at the dsh.zuos.us plugin marketplace', () => {
  assert.equal(MARKETPLACE_URL, 'https://dsh.zuos.us/')
})

test('the marketplace URL is a safe, absolute https address', () => {
  const parsed = new URL(MARKETPLACE_URL)
  assert.equal(parsed.protocol, 'https:', 'a secure page')
  assert.equal(parsed.hostname, 'dsh.zuos.us', 'the marketplace host, not a checkout remote')
})

test('the browser half repeats the same address, so the two halves cannot drift', () => {
  // The browser half cannot import this Host-only ESM module, so it repeats the
  // address. This test is what keeps the repetition honest.
  const client = readFileSync(join(here, '..', 'client.js'), 'utf8')
  const declared = /const MARKETPLACE_URL = '([^']+)'/u.exec(client)
  assert.ok(declared !== null, 'the browser half declares the marketplace address')
  assert.equal(declared[1], MARKETPLACE_URL, 'both halves name the same page')
})

test('the browser half no longer declares a project-link route or remotes', () => {
  const client = readFileSync(join(here, '..', 'client.js'), 'utf8')
  assert.doesNotMatch(client, /PROJECT_LINK_PATH/u, 'no Host route fetch for the link')
  assert.doesNotMatch(client, /PROJECT_LINK_FALLBACK/u, 'no GitHub fallback for the link')
  assert.doesNotMatch(client, /PROJECT_LINK_TIMEOUT_MS/u, 'no prefetch timeout for the link')
})
