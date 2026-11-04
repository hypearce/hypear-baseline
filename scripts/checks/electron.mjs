// Electron security checks. Static pattern checks, so findings are leads to
// confirm, not proof. Runs when the project depends on Electron.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RULES = [
  { re: /\bnodeIntegration\s*:\s*true\b/, severity: 'bug', message: '`nodeIntegration: true` gives web content full Node.js access.' },
  { re: /\bnodeIntegrationInWorker\s*:\s*true\b/, severity: 'bug', message: '`nodeIntegrationInWorker: true` gives workers full Node.js access.' },
  { re: /\bcontextIsolation\s*:\s*false\b/, severity: 'bug', message: '`contextIsolation: false` lets page scripts reach preload internals.' },
  { re: /\bwebSecurity\s*:\s*false\b/, severity: 'bug', message: '`webSecurity: false` disables the same-origin policy.' },
  { re: /\ballowRunningInsecureContent\s*:\s*true\b/, severity: 'bug', message: '`allowRunningInsecureContent: true` allows HTTP content on HTTPS pages.' },
  { re: /\bsandbox\s*:\s*false\b/, severity: 'risk', message: '`sandbox: false` runs the renderer without the Chromium sandbox.' },
  { re: /exposeInMainWorld\([^)]*\bipcRenderer\b(?!\.)/, severity: 'bug', message: 'Exposes `ipcRenderer` directly to the page; expose narrow functions instead.' },
  {
    re: /\bshell\.openExternal\(\s*(?!['"`])/,
    // Suppressed when the preceding lines check the protocol.
    guard: /https\?|https:|\.protocol\b|new URL\(|allow-?list/i,
    severity: 'risk',
    message: '`shell.openExternal` with a non-literal URL and no visible protocol check; validate the protocol and host first.',
  },
  {
    // Dev-server URLs (devUrl, VITE_*, ELECTRON_RENDERER_URL) are expected.
    re: /\.loadURL\(\s*(?!['"`])(?![^)]*(?:dev|VITE_|ELECTRON_RENDERER_URL))/i,
    severity: 'risk',
    message: '`loadURL` with a dynamic URL; make sure it can only point at trusted content.',
  },
]

// Channel may be a literal or a constant (IPC.saveRoute); group 3 is the handler's parameter list.
const IPC_HANDLER = /\bipcMain\.(handle|on|once)\(\s*([^,]+?)\s*,\s*(?:async\s*)?\(([^)]*)\)/
const VALIDATION = /\.(safeParse|parse|assert|validate)\(|\bis[A-Z]\w*\(|typeof\s+\w+\s*[!=]==/

export function usesElectron(root) {
  const manifests = [join(root, 'package.json')]
  for (const dir of ['apps', 'packages']) {
    const base = join(root, dir)
    if (existsSync(base)) for (const d of readdirSync(base)) manifests.push(join(base, d, 'package.json'))
  }
  return manifests.some(m => existsSync(m) && /"electron"\s*:/.test(readFileSync(m, 'utf8')))
}

export function electronChecks(files, read) {
  const findings = []
  for (const path of files) {
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(path) || /(^|\/)(node_modules|out|dist)\//.test(path)) continue
    const buf = read(path)
    if (!buf) continue
    const lines = buf.toString('utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
      for (const r of RULES) if (r.re.test(text) && !(r.guard && r.guard.test(context))) findings.push({ severity: r.severity, rule: 'electron-security', file: path, line: i + 1, message: r.message })
      const ipc = IPC_HANDLER.exec(text)
      if (ipc) {
        // A handler whose parameters go beyond the event receives renderer data.
        const takesArgs = ipc[3].split(',').filter(p => p.trim()).length > 1
        const body = lines.slice(i, i + 15).join('\n')
        if (takesArgs && !VALIDATION.test(body)) {
          const channel = ipc[2].replace(/^['"`]|['"`]$/g, '')
          findings.push({ severity: 'risk', rule: 'electron-ipc-validation', file: path, line: i + 1, message: `IPC handler ${channel} receives renderer data with no visible runtime validation. TypeScript types are not checked at runtime; validate the payload (for example with Zod) here or confirm the called function does.` })
        }
      }
    })
  }
  return findings
}
