# OpenClaw Runtime Patches

## Tilde path fix
- runtime: openclaw@2026.5.2
- dist: /home/msbel/.npm-global/lib/node_modules/openclaw/dist/
- dist hash before patch: 4d667f4a26f84aad2340df3840fe323e2350265a2a43bb0d83a2f5f75967f3fa
- backup: /home/msbel/.npm-global/lib/node_modules/openclaw/dist.before-tilde-fix-2026.5.2-1777921905
- patched: fs-safe-H8HAlurL.js
- secondary inspected: pi-tools-J9lznXGK.js
- change: expand rootDir with home-prefix before fs.realpath in fs-safe boundary.
- rollback: rsync -a --delete "/home/msbel/.npm-global/lib/node_modules/openclaw/dist.before-tilde-fix-2026.5.2-1777921905/" "/home/msbel/.npm-global/lib/node_modules/openclaw/dist/" && systemctl --user restart openclaw-gateway
