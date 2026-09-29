// Native boundary checks supplement (not replace) the real javac/java integration
// in java-launch-regression.test.mjs. Native execution is validated by the parent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const host = readFileSync(new URL('../native/run_host.cpp', import.meta.url), 'utf8')

test('native run.start queues main after beforeLaunch instead of launching it first', () => {
  const start = host.slice(host.indexOf('Json Manager::start('), host.indexOf('Json Manager::stop('))
  const append = start.indexOf('chain.push_back(main)')
  const first = start.indexOf('first = chain.front()')
  const pop = start.indexOf('chain.pop_front()')
  const store = start.indexOf('instance->steps = std::move(chain)')
  assert.ok(append >= 0 && first > append && pop > first && store > pop,
    'the queue must be [beforeLaunch..., main], with its head removed before storing remaining steps')
})

test('unnamed javac still announces its instance before output and exit', () => {
  const start = host.slice(host.indexOf('Json Manager::start('), host.indexOf('Json Manager::stop('))
  assert.doesNotMatch(start, /if\s*\(!instance->label\.empty\(\)\)\s*impl_->post\(\{\{"event", "run.started"\}/,
    'an unnamed build must not skip run.started (runToExit depends on the active instance)')
})

test('shell payload keeps an outer quote pair for cmd /s /c', () => {
  assert.ok(host.includes('L"\\\"" + wide(step.command) + L"\\\""'),
    'cmd /s removes the first and last quote: preserve the quoted JDK executable inside a wrapper pair')
})

test('spawn failure closes the instance announced by run.started', () => {
  const start = host.slice(host.indexOf('Json Manager::start('), host.indexOf('Json Manager::stop('))
  const failed = start.slice(start.indexOf('} catch (...) {'))
  assert.ok(failed.includes('"run.exit"') && failed.includes('"code", -1'),
    'a failed CreateProcess must not leave a permanently running console')
})

test('structured application arguments are quoted as individual Windows argv tokens', () => {
  assert.match(host, /spec\.arguments\.push_back\(quote_argument\(wide\(argument\)\)\)/,
    'classpath with spaces, empty args and embedded quotes must not be concatenated raw')
})
