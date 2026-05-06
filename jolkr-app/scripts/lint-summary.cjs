const fs = require('fs');
const path = process.argv[2] || 'lint-temp.json';
const data = JSON.parse(fs.readFileSync(path, 'utf-8'));
for (const f of data) {
  if (f.messages.length === 0) continue;
  console.log(f.filePath.replace(/\\/g, '/').split('/jolkr-app/')[1]);
  for (const m of f.messages) {
    const sev = m.severity === 2 ? 'err' : 'warn';
    const msg = (m.message || '').split('\n')[0].slice(0, 140);
    console.log(`  ${m.line}:${m.column} [${sev}] ${m.ruleId} :: ${msg}`);
  }
}
