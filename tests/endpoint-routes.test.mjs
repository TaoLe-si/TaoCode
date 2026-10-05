// 端点类级前缀与客户端调用（`src/endpointRoutes.ts`）：`/api` + `/users` 拼全，客户端调用反推端点。
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEndpointReport, classRoutePrefixes, clientEndpointCalls, clientEndpointSummary, joinRoute, mergeEndpointPrefixes, reportClientCount } from '../src/endpointRoutes.ts'

test('类级前缀：类型声明上方的 @RequestMapping/@Path', () => {
  const text = [
    '@RestController',
    '@RequestMapping("/api")',
    'public class UserController {',
    '    @GetMapping("/users")',
    '    public List<User> list() { return null; }',
    '}',
  ].join('\n')
  const prefixes = classRoutePrefixes(text)
  assert.equal(prefixes.length, 1)
  assert.equal(prefixes[0].route, '/api')
  assert.equal(prefixes[0].classLine, 2)
  assert.equal(prefixes[0].framework, 'Spring')
})

test('方法上的 @RequestMapping 不当类前缀；@Path 也认', () => {
  const text = [
    'public class A {',
    '    @RequestMapping("/m")',
    '    public void m() {}',
    '}',
    '@Path("/jax")',
    'interface B {}',
  ].join('\n')
  const prefixes = classRoutePrefixes(text)
  assert.deepEqual(prefixes.map(prefix => prefix.route), ['/jax'])
})

test('joinRoute：归一化拼接，空前缀/根前缀回退到方法路径', () => {
  assert.equal(joinRoute('/api', '/users'), '/api/users')
  assert.equal(joinRoute('/api/', 'users/'), '/api/users')
  assert.equal(joinRoute('', '/users'), '/users')
  assert.equal(joinRoute('/', '/users'), '/users')
})

test('mergeEndpointPrefixes：上方最近的类前缀补全路由', () => {
  const entry = { path: 'A.java', line: 3, method: 'GET', route: '/users', framework: 'Spring' }
  const other = { path: 'A.java', line: 0, method: 'GET', route: '/top', framework: 'Spring' }
  const text = ['@RequestMapping("/api")', 'class A {', '  @GetMapping("/users")', '  void list() {}', '}'].join('\n')
  const merged = mergeEndpointPrefixes([entry, other], { 'A.java': text })
  assert.equal(merged[0].route, '/api/users')
  assert.equal(merged[1].route, '/top', '类声明之前的条目没有前缀可加')
  const untouched = mergeEndpointPrefixes([entry], {})
  assert.equal(untouched[0].route, '/users', '拿不到全文时原样返回')
})

test('客户端端点：fetch/axios/requests/WebClient，动态段原样保留', () => {
  const text = [
    "const r = await fetch('/api/users', { method: 'POST' })",
    "axios.get('/api/items')",
    "requests.post('/api/login', json=data)",
    'this.http.get<Item[]>("/api/items")',
    "webClient.post().uri('/api/events').retrieve()",
    "http.Get(\"/health\")",
  ].join('\n')
  const calls = clientEndpointCalls('src/api.ts', text)
  const byRoute = Object.fromEntries(calls.map(call => [call.route, call.method]))
  assert.equal(byRoute['/api/users'], 'POST')
  assert.equal(byRoute['/api/items'], 'GET')
  assert.equal(byRoute['/api/login'], 'POST')
  assert.equal(byRoute['/api/events'], 'POST')
  assert.ok(calls.every(call => call.framework.startsWith('客户端/')))
  assert.equal(clientEndpointSummary(calls), '5 个客户端调用 / 1 个文件')
})

test('客户端端点：一行只取第一个命中；模板串 `\\${id}` 原样保留', () => {
  const calls = clientEndpointCalls('a.ts', "axios.get(`/api/users/${id}`); fetch('/ignored')")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].route, '/api/users/${id}')
  assert.equal(clientEndpointSummary([]), '')
})

test('buildEndpointReport：前缀合并 + 客户端条目并表，开关关掉只剩控制器', () => {
  const controller = { path: 'src/UserController.java', line: 3, method: 'GET', route: '/users', framework: 'Spring' }
  const texts = {
    'src/UserController.java': ['@RequestMapping("/api")', 'class UserController {', '  @GetMapping("/users")', '  void list() {}', '}'].join('\n'),
    'web/api.ts': "fetch('/api/users', { method: 'POST' })",
  }
  const report = buildEndpointReport([controller], texts, true)
  assert.deepEqual(report.map(entry => `${entry.method} ${entry.route} @${entry.path}`), [
    'GET /api/users @src/UserController.java',
    'POST /api/users @web/api.ts',
  ])
  // 同路由的控制器与客户端条目排序按路径稳定；客户端计数单独可查。
  assert.equal(reportClientCount(report), 1)
  const controllersOnly = buildEndpointReport([controller], texts, false)
  assert.deepEqual(controllersOnly.map(entry => entry.route), ['/api/users'])
  assert.equal(reportClientCount(controllersOnly), 0)
  // 没有全文时：前缀不合并，但客户端条目仍来自能读到的文件。
  const noTexts = buildEndpointReport([controller], {}, true)
  assert.deepEqual(noTexts.map(entry => entry.route), ['/users'])
})
