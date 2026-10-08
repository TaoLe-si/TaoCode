// 配置备份（`src/configBackup.ts`）的判据 —— `pf/lifecycle` 判词里那条「工程配置迁移与备份」。
//
// 上游坐标（逐条核过，可复现）：
//   · `platform/platform-impl/src/com/intellij/openapi/application/ConfigBackup.kt:24`（MAX_BACKUPS_NUMBER = 10）
//   · 同文件 `:60`（DATE_FORMAT）、`:63-75`（getNextBackupPath 的碰撞分支）、`:46-58`（cleanupOldBackups
//     的闭区间 `0..size-MAX`）、`:75`（备份目录 = 配置目录的兄弟目录）
//   · `platform/configuration-store-impl/src/defaults/DefaultSettingsHelper.kt:39-45,53`
//     （恢复默认前算备份路径并写进确认正文）
// 接线判据盯的是「恢复默认那条链路真的先备份再复位」——规则再好，没接上就等于没有。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BACKUP_DIR_SUFFIX, BACKUP_EXTENSION, BACKUP_DATE_FORMAT, MAX_BACKUPS_NUMBER, STATE_FILE_NAME,
  backupDateStamp, backupLedgerKey, backupNotice, backupsToDelete, configBackupDir,
  forgottenBackupsNotice, nextBackupPath, pruneBackupLedger, readBackupLedger, rememberBackup,
} from '../src/configBackup.ts'
import { restoreConfirmMessage } from '../src/settingsTransfer.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = relative => readFileSync(join(root, relative), 'utf8')

/** 假存储（隐私模式/无 localStorage 的退路也要能测）。 */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return { getItem: key => (map.has(key) ? map.get(key) : null), setItem(key, value) { map.set(key, value) }, size: () => map.size }
}

test('上游常量照抄：10 档 / 日期格式 / 备份目录后缀 / 状态文件名', () => {
  assert.equal(MAX_BACKUPS_NUMBER, 10, 'ConfigBackup.kt:24')
  assert.equal(BACKUP_DATE_FORMAT, 'yyyy-MM-dd-HH-mm', 'ConfigBackup.kt:60')
  assert.equal(BACKUP_DIR_SUFFIX, '-backup', 'ConfigBackup.kt:75')
  assert.equal(BACKUP_EXTENSION, '.zip', '本仓用 app.exportSettings 的包格式')
  assert.equal(STATE_FILE_NAME, 'projects.json', 'native/projects.cpp 的 state_file_')
})

test('备份目录是配置目录的**兄弟**目录，不是子目录（ConfigBackup.kt:75）', () => {
  assert.equal(configBackupDir('C:/Users/x/AppData/Roaming/TaoCode'), 'C:/Users/x/AppData/Roaming/TaoCode-backup')
  assert.equal(configBackupDir('D:\\work\\profile\\'), 'D:\\work\\profile-backup', '尾部分隔符先削掉')
  assert.equal(configBackupDir('profile'), 'profile-backup', '没有分隔符时同级')
  assert.ok(!configBackupDir('C:/a/profile').startsWith('C:/a/profile/'), '不能是子目录')
})

test('日期戳是本地时间，五段补零（DATE_FORMAT）', () => {
  assert.equal(backupDateStamp(new Date(2026, 0, 5, 9, 7)), '2026-01-05-09-07')
  assert.equal(backupDateStamp(new Date(2026, 11, 31, 23, 59)), '2026-12-31-23-59')
})

test('这一档路径 = <备份目录>/<日期>-<唯一后缀>.zip（后缀常开，理由见模块头）', () => {
  const path = nextBackupPath('C:/p/profile', new Date(2026, 5, 1, 12, 30), 'abc123')
  assert.equal(path, 'C:/p/profile-backup/2026-06-01-12-30-abc123.zip')
  assert.ok(path.endsWith(BACKUP_EXTENSION))
  assert.notEqual(nextBackupPath('C:/p/profile', new Date(2026, 5, 1, 12, 30), 'x'),
    nextBackupPath('C:/p/profile', new Date(2026, 5, 1, 12, 30), 'y'), '两次备份不撞名')
})

test('旧档清理条数 = size-MAX+1（ConfigBackup.kt:46-58 的闭区间 0..size-MAX）', () => {
  assert.deepEqual(backupsToDelete([]), [], '不到上限不删')
  assert.deepEqual(backupsToDelete(Array.from({ length: 9 }, (_, i) => `2026-01-0${i + 1}-00-00`)), [])
  const ten = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}-00-00`)
  // 恰好 10 档：删 1 条（最老的），留 9 ⇒ 紧接着新备份补回第 10 条。
  assert.deepEqual(backupsToDelete(ten), ['2026-01-01-00-00'])
  // 11 档：删 2 条。
  const eleven = ['2025-12-31-00-00', ...ten]
  assert.deepEqual(backupsToDelete(eleven), ['2025-12-31-00-00', '2026-01-01-00-00'])
  // 按**名字**排序，不是按传入顺序。
  assert.deepEqual(backupsToDelete([...ten].reverse()), ['2026-01-01-00-00'])
})

test('备份账：读/记/收，坏存档一律退化成空表（永不抛）', () => {
  const storage = fakeStorage()
  const profile = 'C:/p/profile'
  assert.equal(backupLedgerKey(profile), `taocode.configBackups.${encodeURIComponent(profile)}`)
  assert.deepEqual(readBackupLedger(profile, storage), [])
  rememberBackup(profile, 'a.zip', storage)
  rememberBackup(profile, 'b.zip', storage)
  assert.deepEqual(readBackupLedger(profile, storage), ['b.zip', 'a.zip'], '新的在最前')
  assert.deepEqual(readBackupLedger(profile, fakeStorage({ [backupLedgerKey(profile)]: '{oops' })), [])
  assert.deepEqual(readBackupLedger(profile, fakeStorage({ [backupLedgerKey(profile)]: '[1,"x",null]' })), ['x'])
  assert.deepEqual(readBackupLedger(profile, null), [], '没有存储 = 空账')
})

test('收账：超出上限的被遗忘，**保留的那些仍在账上**（本仓删不了磁盘文件）', () => {
  const storage = fakeStorage()
  const profile = 'C:/p/profile'
  const names = Array.from({ length: 11 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}-00-00.zip`)
  const { kept, forgotten } = pruneBackupLedger(profile, names, MAX_BACKUPS_NUMBER, storage)
  assert.deepEqual(forgotten, ['2026-01-01-00-00.zip', '2026-01-02-00-00.zip'], 'size-MAX+1 = 2 条')
  assert.equal(kept.length, 9)
  assert.deepEqual(readBackupLedger(profile, storage), kept, '收账写回存储')
  assert.equal(forgottenBackupsNotice(forgotten).includes('2 档备份仍在磁盘上'), true)
  assert.equal(forgottenBackupsNotice([]), null, '没忘掉就不提示')
})

test('确认正文里带备份路径（DefaultSettingsHelper.kt:39-45 + restore...confirmation.message）', () => {
  assert.ok(backupNotice('D:/p/profile-backup/x.zip').includes('D:/p/profile-backup/x.zip'))
  assert.ok(backupNotice(null).includes('备份'))
  const message = restoreConfirmMessage('D:/p/profile-backup/2026-06-01-12-30-x.zip')
  assert.ok(message.includes('D:/p/profile-backup/2026-06-01-12-30-x.zip'), '要说清备份到哪')
  assert.ok(message.includes('不可撤销') && message.includes('最近项目列表'), '原有三条断言不许丢')
  assert.ok(restoreConfirmMessage().includes('恢复默认设置？'), '不传路径也要能用（预览/拿不到 profile）')
})

test('恢复默认的链路真的是「算路径 → 确认 → 备份 → 复位」', () => {
  const source = read('src/settingsTransfer.ts')
  const path = source.indexOf('nextBackupPath(profile)')
  const confirm = source.indexOf('if (!confirm(restoreConfirmMessage(backupPath))) return')
  const backup = source.indexOf("request('app.exportSettings', { path: backupPath })")
  const reset = source.indexOf("request<AppState>('app.resetSettings')")
  assert.ok(path >= 0 && confirm >= 0 && backup >= 0 && reset >= 0, '四处都要在')
  assert.ok(path < confirm, '路径要在确认之前算出来（确认正文里要显示它）')
  assert.ok(confirm < backup && backup < reset, '备份要在确认之后、复位之前（坏顺序 = 复位了却没备份）')
  assert.match(source, /app\.info/, '配置目录要问 app.info（冻结的 App.vue 不许再多传实参）')
  assert.doesNotMatch(source, /deps\.profileDir === undefined \? null/, '不传 profileDir 时要自己去问，不能直接跳过备份')
})