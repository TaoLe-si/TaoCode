// EP 判据：`com.intellij.microservices.endpointsProvider` 的宿主（`src/endpointIndex.ts`）。
//
// 上游依据：EP 声明 `platform/lang-api/resources/intellij.platform.lang.xml:182-183`
// `<extensionPoint qualifiedName="com.intellij.microservices.endpointsProvider"
//  interface="com.intellij.microservices.endpoints.EndpointsProvider" dynamic="true"/>`。
// 三件事：① bundled 文本扫描供给方仍在；② 第三方按 EP id 挂的供给方被真实消费点
// `buildEndpointIndex()` 合并解析；③ EP id 逐字等于上游。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ENDPOINTS_PROVIDER_EP, TEXT_SCAN_ENDPOINTS_PROVIDER, buildEndpointIndex, endpointScanQuery,
  endpointsProvidersFromExtensions, registerEndpointsProvider, unregisterEndpointsProvider,
} from '../src/endpointIndex.ts'

test('EP id 逐字等于上游 qualifiedName', () => {
  assert.equal(ENDPOINTS_PROVIDER_EP, 'com.intellij.microservices.endpointsProvider')
})

test('bundled 文本扫描供给方仍在 EP 上', () => {
  assert.ok(endpointsProvidersFromExtensions().some(provider => provider.id === TEXT_SCAN_ENDPOINTS_PROVIDER.id))
})

test('第三方按 EP id 注册后被真实消费点合并解析', () => {
  const handle = registerEndpointsProvider({
    id: 'acme-grpc', scanQuery: '@GrpcMethod', parseLine: (path, line, text) => {
      const match = /@GrpcMethod\s*\(\s*['"]([^'"]+)['"]/.exec(text)
      return match ? { path, line, method: 'RPC', route: match[1], framework: 'gRPC' } : null
    },
  })
  try {
    const matches = [
      { path: 'a.ts', line: 1, preview: 'app.get("/x", handler)' },
      { path: 'b.proto', line: 3, preview: '@GrpcMethod("Echo")' },
    ]
    const entries = buildEndpointIndex(matches)
    assert.ok(entries.some(entry => entry.framework === 'gRPC' && entry.route === 'Echo'), '第三方供给方解析出端点')
    assert.ok(entries.some(entry => entry.framework === 'Node/Router'), 'bundled 供给方仍在工作')
    assert.match(endpointScanQuery(), /@GrpcMethod/, '扫描正则并进了第三方片段')
  } finally {
    handle.dispose()
  }
  assert.equal(buildEndpointIndex([{ path: 'b.proto', line: 3, preview: '@GrpcMethod("Echo")' }]).length, 0,
    '注销后第三方供给方不再解析')
})

test('unregister 返回真值语义', () => {
  assert.equal(unregisterEndpointsProvider('does-not-exist'), false)
})
