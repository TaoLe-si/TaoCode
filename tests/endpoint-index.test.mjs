import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEndpointIndex, endpointSummary, normalizeRoute, parseEndpointLine } from '../src/endpointIndex.ts'

const parse = (text, line = 3) => parseEndpointLine('src/api.ts', line, text)

test('Spring 注解：GetMapping / RequestMapping 的路径与方法', () => {
  assert.deepEqual(parse('@GetMapping("/api/users")'), { path: 'src/api.ts', line: 3, method: 'GET', route: '/api/users', framework: 'Spring' })
  const mapping = parse('@RequestMapping(value = "/api/orders", method = RequestMethod.POST)')
  assert.equal(mapping?.method, 'POST')
  assert.equal(mapping?.route, '/api/orders')
  assert.equal(parse('@PostMapping(path = "/x")')?.method, 'POST')
})

test('JAX-RS @Path 方法留空（方法标注通常另起一行，不猜）', () => {
  const entry = parse('@Path("/users/{id}")')
  assert.equal(entry?.method, '')
  assert.equal(entry?.route, '/users/{id}')
  assert.equal(entry?.framework, 'JAX-RS')
})

test('FastAPI/Flask：装饰器带方法与 route 的 methods 参数', () => {
  assert.deepEqual(parse('@app.get("/items")'), { path: 'src/api.ts', line: 3, method: 'GET', route: '/items', framework: 'FastAPI/Flask' })
  const route = parse("@app.route('/old', methods=['POST'])")
  assert.equal(route?.method, 'POST')
  assert.equal(route?.route, '/old')
})

test('Express/gin/标准库：router 调用与方法标签', () => {
  assert.equal(parse("app.get('/users', handler)")?.method, 'GET')
  assert.equal(parse("router.post('/y', handler)")?.route, '/y')
  assert.equal(parse('r.GET("/metrics", h)')?.method, 'GET')
  assert.equal(parse("http.HandleFunc('/health', h)")?.method, '')
  assert.equal(parse("mux.HandleFunc('/health', h)")?.route, '/health')
})

test('ASP.NET 特性', () => {
  assert.deepEqual(parse('[HttpGet("weather")]'), { path: 'src/api.ts', line: 3, method: 'GET', route: '/weather', framework: 'ASP.NET' })
  assert.equal(parse('[Route("api/[controller]")]')?.route, '/api/[controller]')
})

test('非路由行返回 null；没有路径的注解不算端点', () => {
  assert.equal(parse('const x = 1'), null)
  assert.equal(parse('@RequestMapping(method = RequestMethod.GET)'), null)
  assert.equal(parse('// @GetMapping("/x") 注释里的不算吗'), null)
})

test('路由归一：补前导斜杠、去尾斜杠', () => {
  assert.equal(normalizeRoute('users'), '/users')
  assert.equal(normalizeRoute('/users/'), '/users')
  assert.equal(normalizeRoute('/'), '/')
})

test('索引按路由排序并去重，摘要报文件数与框架计数', () => {
  const entries = buildEndpointIndex([
    { path: 'src/a.ts', line: 1, column: 1, preview: '@GetMapping("/b")', length: 0 },
    { path: 'src/a.ts', line: 5, column: 1, preview: '@GetMapping("/b")', length: 0 },
    { path: 'src/b.ts', line: 2, column: 1, preview: "app.get('/a', h)", length: 0 },
    { path: 'src/b.ts', line: 9, column: 1, preview: 'const x = 1', length: 0 },
  ])
  assert.deepEqual(entries.map(entry => `${entry.method} ${entry.route}`), ['GET /a', 'GET /b'])
  assert.equal(endpointSummary(entries), '2 个端点 / 2 个文件（Node/Router 1，Spring 1）')
})
