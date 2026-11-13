import { build } from 'esbuild';
import fs from 'fs';
const r = await build({ entryPoints: ['src/game.js'], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'inline' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const notices = fs.readFileSync('THIRD-PARTY-NOTICES.md', 'utf8').replace(/--+/g, '-');
const html = fs.readFileSync('template.html', 'utf8').replace('/*__GAME__*/', () => js).replace(/^<!DOCTYPE html>\n?/i, () => '<!DOCTYPE html>\n<!--\n' + notices + '-->\n');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('size KB', (html.length / 1024) | 0);
