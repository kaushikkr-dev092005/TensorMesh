// Alternative frontend build for environments that cannot spawn Vite's esbuild service.
import './sync-runtime.mjs';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import ts from 'typescript';
import { mkdir, cp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const appRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const distRoot = path.resolve(appRoot, 'dist');
if (path.dirname(distRoot) !== appRoot || path.basename(distRoot) !== 'dist') throw new Error('Invalid generated output directory');
await rm(distRoot, {recursive:true, force:true});
const bundle = await rollup({ input: 'src/main.tsx', plugins: [
 { name:'typescript-and-env', transform(code,id){ if(id.endsWith('.css'))return {code:'export default {};',map:null}; if(/\.[jt]sx?$/.test(id)){ code=code.replaceAll('process.env.NODE_ENV',JSON.stringify('production')); if(/\.tsx?$/.test(id))return {code:ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,map:null};return {code,map:null}; } } },
 nodeResolve({browser:true,extensions:['.mjs','.js','.json','.ts','.tsx']}), commonjs()
] });
await mkdir('dist/assets',{recursive:true});
await bundle.write({file:'dist/assets/app.js',format:'es',sourcemap:true});
await bundle.close();
await cp('src/styles.css','dist/assets/app.css');
await cp('public','dist',{recursive:true});
await writeFile('dist/index.html','<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TensorMesh</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>');
console.log('TensorMesh portable frontend built in dist/');
