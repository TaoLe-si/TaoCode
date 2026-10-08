/** ZCode MFJS tool schema adapter. Source: apps/zcode-cli/packages/adapters/src/model/tool-transform.ts. */

/** Hoist non-`$defs` local JSON Schema references for models requiring the MFJS shape. */
export function adaptAgentToolInputSchema(
  schema: unknown,
  toolName: string,
  requiresMfjsToolSchema: boolean,
): unknown {
  if (!requiresMfjsToolSchema) return schema
  const root = asPlainRecord(schema)
  if (!root) return schema

  const refs = new Set<string>()
  collectNonDefsLocalRefs(root, refs)
  const unresolvedRef = [...refs].find(ref => resolveLocalJsonPointer(root, ref) === undefined)
  if (unresolvedRef) {
    throw new Error(`Tool ${toolName} contains an unresolvable local schema reference ${unresolvedRef}`)
  }
  if (refs.size === 0) return schema

  const existingDefs = asPlainRecord(root.$defs) ?? {}
  const usedDefKeys = new Set(Object.keys(existingDefs))
  const defKeyByRef = new Map<string, string>()
  let nextDefIndex = 0
  for (const ref of refs) {
    let defKey = `zcode_ref_${nextDefIndex}`
    while (usedDefKeys.has(defKey)) {
      nextDefIndex += 1
      defKey = `zcode_ref_${nextDefIndex}`
    }
    nextDefIndex += 1
    usedDefKeys.add(defKey)
    defKeyByRef.set(ref, defKey)
  }

  // `rewriteJsonSchemaRefs` 的返回是 `unknown`（它递归走任意 JSON 值）；这里按根必须是
  // 普通对象来收窄 —— 非对象时退回空对象，与 spread 一个非对象同义，但不触发 TS2698/TS18046。
  const rewrittenRoot = asPlainRecord(rewriteJsonSchemaRefs(root, defKeyByRef)) ?? {}
  const rewrittenDefs = asPlainRecord(rewrittenRoot.$defs) ?? {}
  const hoistedDefs: Record<string, unknown> = {}
  for (const [ref, defKey] of defKeyByRef) {
    hoistedDefs[defKey] = rewriteJsonSchemaRefs(resolveLocalJsonPointer(root, ref), defKeyByRef)
  }

  return {
    ...rewrittenRoot,
    $defs: { ...rewrittenDefs, ...hoistedDefs },
  }
}

function collectNonDefsLocalRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectNonDefsLocalRefs(item, refs)
    return
  }
  const record = asPlainRecord(value)
  if (!record) return
  if (typeof record.$ref === 'string' && record.$ref.startsWith('#/') && !record.$ref.startsWith('#/$defs/')) {
    refs.add(record.$ref)
  }
  for (const child of Object.values(record)) collectNonDefsLocalRefs(child, refs)
}

function resolveLocalJsonPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  let current = root
  try {
    for (const encodedSegment of ref.slice(2).split('/')) {
      const segment = decodeURIComponent(encodedSegment).replaceAll('~1', '/').replaceAll('~0', '~')
      if (Array.isArray(current)) {
        if (!/^\d+$/u.test(segment)) return undefined
        current = current[Number(segment)]
        continue
      }
      const record = asPlainRecord(current)
      if (!record || !Object.prototype.hasOwnProperty.call(record, segment)) return undefined
      current = record[segment]
    }
  } catch {
    return undefined
  }
  return current
}

function rewriteJsonSchemaRefs(value: unknown, defKeyByRef: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => rewriteJsonSchemaRefs(item, defKeyByRef))
  const record = asPlainRecord(value)
  if (!record) return value
  return Object.fromEntries(Object.entries(record).map(([key, child]) => {
    if (key === '$ref' && typeof child === 'string') {
      const defKey = defKeyByRef.get(child)
      if (defKey) return [key, `#/$defs/${defKey}`]
    }
    return [key, rewriteJsonSchemaRefs(child, defKeyByRef)]
  }))
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
