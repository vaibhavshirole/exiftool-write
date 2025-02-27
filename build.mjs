import { build } from 'esbuild';
import { raw } from "esbuild-raw-plugin";

const prod = build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    outfile: 'dist/esm/index.esm.js',
    sourcemap: true,
    minify: true,
    plugins: [raw()],
    target: ['ESNext'],
});

const demo = build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    outfile: 'demo/index.esm.js',
    sourcemap: true,
    minify: false,
    plugins: [raw()],
});


Promise.all([prod, demo]).catch(() => process.exit(1));
