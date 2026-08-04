const fs = require('node:fs');
const path = require('node:path');

const [sourceDir, projectDir = path.resolve(__dirname, '..')] = process.argv.slice(2).map((value) => path.resolve(value));
if (!sourceDir) throw new Error('用法: node scripts/migrate-data.js <迁移包目录> [项目目录]');

const sourceDataFile = path.join(sourceDir, 'data.json');
const manifestFile = path.join(sourceDir, 'images', 'manifest.json');
const targetDataFile = path.join(projectDir, 'data.json');
const targetMediaDir = path.join(projectDir, 'data', 'images');
const source = JSON.parse(fs.readFileSync(sourceDataFile, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

if (!Array.isArray(source.records) || !Array.isArray(source.groups) || !Array.isArray(manifest.items)) {
  throw new Error('迁移数据结构无效');
}

const imageByRecord = new Map();
fs.mkdirSync(targetMediaDir, { recursive: true });
for (const item of manifest.items) {
  const file = path.basename(String(item.file || ''));
  if (!file || file !== item.file || !/^[\w.-]+\.(?:jpe?g|png|webp|gif)$/i.test(file)) throw new Error(`不安全的图片文件名: ${item.file}`);
  const from = path.join(sourceDir, 'images', file);
  if (!fs.statSync(from).isFile()) throw new Error(`图片不存在: ${file}`);
  const target = path.join(targetMediaDir, file);
  fs.copyFileSync(from, target);
  fs.chmodSync(target, 0o600);
  imageByRecord.set(String(item.recordKey), `/media/${encodeURIComponent(file)}`);
}

const records = source.records.map((record) => {
  const key = String(record.key || `${record.name}_${record.day}`);
  return {
    key,
    name: String(record.name || '').trim(),
    day: Number(record.day),
    text: typeof record.text === 'string' ? record.text : '',
    image: imageByRecord.get(key) || null,
    time: Number(record.time),
    feedback: typeof record.feedback === 'string' ? record.feedback : '',
    ...(Number.isFinite(Number(record.feedbackTime)) ? { feedbackTime: Number(record.feedbackTime) } : {})
  };
});

if (records.some((record) => !record.key || !record.name || !Number.isInteger(record.day) || !Number.isFinite(record.time))) {
  throw new Error('迁移记录含无效必填字段');
}
if (new Set(records.map((record) => record.key)).size !== records.length) throw new Error('迁移记录 key 重复');
if (records.filter((record) => record.image).length !== manifest.items.length) throw new Error('图片关联数量不匹配');

const migrated = {
  schemaVersion: 'reading-checkin/v2',
  migratedAt: new Date().toISOString(),
  groups: source.groups.map((group) => ({ name: String(group.name), leader: String(group.leader || ''), members: group.members.map(String) })),
  records
};
const temporary = `${targetDataFile}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(migrated, null, 2), { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temporary, targetDataFile);
fs.chmodSync(targetDataFile, 0o600);
console.log(JSON.stringify({ records: records.length, groups: migrated.groups.length, members: new Set(records.map((record) => record.name)).size, images: manifest.items.length, feedbacks: records.filter((record) => record.feedback).length }));
