#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { promises as fs } from "fs";
import fsSync from "fs";
import { execSync, spawnSync } from "child_process";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
    copyAssets,
    checkGzipSize,
    generateServiceWorker,
} from "./build/common.js";
import { injectEnv } from "./build/env_inject.js";
import { requireNode22 } from "./build/version_check.js";
import { validateEnv } from "./build/env_validate.js";

const manifest = JSON.parse(
    fsSync.readFileSync(
        new URL("./build_assets.json", import.meta.url),
        "utf8",
    ),
);

requireNode22();

function applyCsp(html, base) {
    const hashes = [];
    const regex = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
    for (const m of html.matchAll(regex)) {
        const h = createHash('sha384').update(m[1]).digest('base64');
        hashes.push(`'sha384-${h}'`);
    }
    const csp = `${base}; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'`;
    return html.replace(
        /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    );
}

function ensureDevPackages() {
    const require = createRequire(import.meta.url);
    const packages = [
        "esbuild",
        "tailwindcss",
        "workbox-build",
        "@web3-storage/w3up-client",
        "dotenv",
    ];
    for (const pkg of packages) {
        try {
            require.resolve(pkg);
        } catch {
            console.error(
                `Missing dependency "${pkg}". Run 'npm ci' before building.`,
            );
            process.exit(1);
        }
    }
}

ensureDevPackages();

const { build } = await import("esbuild");
const w3up = await import("@web3-storage/w3up-client");
const dotenv = (await import("dotenv")).default;
dotenv.config();

try {
    validateEnv(process.env);
} catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}

const verbose = process.argv.includes("--verbose");

try {
    execSync("tsc --noEmit", { stdio: "inherit" });
} catch {
    process.exit(1);
}

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..", "..", "..");
const aliasRoot = path.join(repoRoot, "alpha_factory_v1", "core");
const quickstartPdf = path.join(repoRoot, manifest.quickstart_pdf);
const aliasPlugin = {
    name: "alias",
    setup(build) {
        build.onResolve({ filter: /^@insight-src\// }, (args) => ({
            path: path.join(aliasRoot, args.path.slice("@insight-src/".length)),
        }));
    },
};

async function ensureWeb3Bundle() {
    const bundlePath = path.join("lib", "bundle.esm.min.js");
    let data = await fs.readFile(bundlePath, "utf8").catch(() => "");
    if (!data || data.includes("Placeholder")) {
        runFetch();
        data = await fs.readFile(bundlePath, "utf8").catch(() => "");
        if (!data || data.includes("Placeholder")) {
            throw new Error("Failed to fetch lib/bundle.esm.min.js");
        }
    }
}

async function ensureWorkbox() {
    const wbPath = path.join("lib", "workbox-sw.js");
    let data = await fs.readFile(wbPath, "utf8").catch(() => "");
    if (!data || data.toLowerCase().includes("placeholder")) {
        runFetch();
        data = await fs.readFile(wbPath, "utf8").catch(() => "");
        if (!data || data.toLowerCase().includes("placeholder")) {
            throw new Error("Failed to fetch lib/workbox-sw.js");
        }
    }
}

async function compileWorkers() {
    const workers = ["evolver", "arenaWorker", "umapWorker"];
    await Promise.all(
        workers.map((w) =>
            build({
                entryPoints: [`worker/${w}.ts`],
                outfile: `worker/${w}.js`,
                bundle: false,
                format: "esm",
                target: "es2020",
            }),
        ),
    );
}

function collectFiles(dir) {
    let out = [];
    if (!fsSync.existsSync(dir)) return out;
    for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(collectFiles(p));
        else out.push(p);
    }
    return out;
}

function placeholderFiles() {
    const files = [];
    for (const sub of ["lib"]) {
        const root = path.join(path.dirname(scriptPath), sub);
        for (const f of collectFiles(root)) {
            const data = fsSync.readFileSync(f, "utf8");
            if (data.toLowerCase().includes("placeholder")) files.push(f);
        }
    }
    return files;
}

function runFetch() {
    const script = path.join(repoRoot, "scripts", "fetch_assets.py");
    const res = spawnSync("python", [script], { stdio: "inherit" });
    if (res.status !== 0) process.exit(res.status ?? 1);
}

function ensureAssets() {
    let placeholders = placeholderFiles();
    if (placeholders.length) {
        console.log("Detected placeholder assets, running fetch_assets.py...");
        runFetch();
        placeholders = placeholderFiles();
    }
    if (placeholders.length) {
        throw new Error(`placeholder found in ${placeholders[0]}`);
    }
}

const OUT_DIR = "dist";

async function relocateDistAssets() {
    const assetDir = path.join(OUT_DIR, "assets");
    await fs.mkdir(assetDir, { recursive: true });
    const items = [
        "wasm",
        "wasm_llm",
        "lib",
        "data",
        "src",
        "d3.v7.min.js",
        "favicon.svg",
        "insight_browser_quickstart.pdf",
        "manifest.json",
    ];
    for (const item of items) {
        const srcPath = path.join(OUT_DIR, item);
        if (fsSync.existsSync(srcPath)) {
            await fs.rename(srcPath, path.join(assetDir, item));
        }
    }
}

async function bundle() {
    const html = await fs.readFile("index.html", "utf8");
    await ensureWeb3Bundle();
    await ensureWorkbox();
    ensureAssets();
    await compileWorkers();
    const ipfsOrigin = process.env.IPFS_GATEWAY
        ? new URL(process.env.IPFS_GATEWAY).origin
        : "";
    const otelOrigin = process.env.OTEL_ENDPOINT
        ? new URL(process.env.OTEL_ENDPOINT).origin
        : "";
    await fs.mkdir(OUT_DIR, { recursive: true });
    const scriptTag =
        '<script type="module" src="insight.bundle.js" crossorigin="anonymous"></script>';
    await build({
        entryPoints: ["app.js"],
        bundle: true,
        minify: true,
        treeShaking: true,
        format: "esm",
        target: "es2020",
        outfile: `${OUT_DIR}/insight.bundle.js`,
        plugins: [aliasPlugin],
        external: ["d3"],
    });
    execSync(`npx tailwindcss -i style.css -o ${OUT_DIR}/style.css --minify`, {
        stdio: "inherit",
    });
    let outHtml = html;
    const cspBase =
        "default-src 'self'; connect-src 'self' https://api.openai.com" +
        (ipfsOrigin ? ` ${ipfsOrigin}` : "") +
        (otelOrigin ? ` ${otelOrigin}` : "");
    const envScript = injectEnv(process.env);
    await copyAssets(manifest, repoRoot, OUT_DIR);
    if (fsSync.existsSync(quickstartPdf)) {
        await fs.copyFile(
            quickstartPdf,
            path.join(OUT_DIR, "insight_browser_quickstart.pdf"),
        );
    }

    const checksums = manifest.checksums || {};

    function verify(buf, name) {
        const expected = checksums[name];
        if (!expected) return;
        const actual =
            "sha384-" + createHash("sha384").update(buf).digest("base64");
        if (actual !== expected) {
            throw new Error(
                `Checksum mismatch for ${name}: expected ${expected} got ${actual}`,
            );
        }
    }

    const wasmPath = "wasm/pyodide.asm.wasm";
    const wasmBuf = fsSync.readFileSync(wasmPath);
    verify(wasmBuf, "pyodide.asm.wasm");
    const wasmBase64 = wasmBuf.toString("base64");
    const wasmSri =
        "sha384-" + createHash("sha384").update(wasmBuf).digest("base64");

    for (const name of ["pyodide.js"]) {
        const p = path.join("wasm", name);
        if (fsSync.existsSync(p)) {
            verify(fsSync.readFileSync(p), name);
        }
    }
    let gpt2Base64 = "";
    if (!wasmBase64) {
        outHtml = outHtml.replace(
            "</head>",
            `<link rel="preload" href="wasm/pyodide.asm.wasm" as="fetch" type="application/wasm" integrity="${wasmSri}" crossorigin="anonymous" />\n</head>`,
        );
    }
    const bundlePath = `${OUT_DIR}/insight.bundle.js`;
    let bundleText = await fs.readFile(bundlePath, "utf8");
    let web3Code = await fs.readFile(
        path.join("lib", "bundle.esm.min.js"),
        "utf8",
    );
    web3Code = web3Code.replace(/export\s+/g, "");
    web3Code += "\nwindow.Web3Storage=Web3Storage;";
    let pyCode = await fs.readFile(path.join("lib", "pyodide.js"), "utf8");
    pyCode = pyCode.replace(/export\s+/g, "");
    pyCode += "\nwindow.loadPyodide=loadPyodide;";
    let ortCode = "";
    const ortPath = path.join(
        "node_modules",
        "onnxruntime-web",
        "dist",
        "ort.all.min.js",
    );
    if (fsSync.existsSync(ortPath)) {
        ortCode = await fs.readFile(ortPath, "utf8");
        ortCode += "\nwindow.ort=ort;";
    }
    bundleText =
        `${web3Code}\n${pyCode}\n${ortCode}\nwindow.PYODIDE_WASM_BASE64='${wasmBase64}';window.GPT2_MODEL_BASE64='${gpt2Base64}';\n` +
        bundleText;
    bundleText = bundleText.replace(
        /\/\/#[ \t]*sourceMappingURL=.*(?:\r?\n)?/g,
        "",
    );
    bundleText = bundleText
        .replace(/\.\/wasm\//g, "./assets/wasm/")
        .replace(/\.\/wasm_llm\//g, "./assets/wasm_llm/")
        .replace(/\.\.\/lib\/bundle\.esm\.min\.js/g, "./assets/lib/bundle.esm.min.js");
    await fs.writeFile(bundlePath, bundleText);
    const data = await fs.readFile(bundlePath);
    const appSri =
        "sha384-" + createHash("sha384").update(data).digest("base64");
    const sriTag = `<script type="module" src="insight.bundle.js" integrity="${appSri}" crossorigin="anonymous"></script>`;
    outHtml = outHtml.replace(scriptTag, sriTag)
        .replace(
            /<script[\s\S]*?bundle\.esm\.min\.js[\s\S]*?<\/script>\s*/g,
            "",
        )
        .replace(/<script[\s\S]*?pyodide\.js[\s\S]*?<\/script>\s*/g, "")
        .replace("</body>", `${envScript}\n</body>`)
        .replace('href="manifest.json"', 'href="assets/manifest.json"')
        .replace('href="favicon.svg"', 'href="assets/favicon.svg"');
    await fs.writeFile(`${OUT_DIR}/index.html`, outHtml);
    const devHtml = html.replace(scriptTag, sriTag);
    if (devHtml !== html) {
        await fs.writeFile("index.html", devHtml);
    }
    await relocateDistAssets();
    manifest.precache = manifest.precache.map((p) => {
        if (
            p.startsWith("wasm") ||
            p.startsWith("wasm_llm") ||
            p.startsWith("data/") ||
            p.startsWith("src/") ||
            p.startsWith("pyodide") ||
            p === "d3.v7.min.js" ||
            p === "insight_browser_quickstart.pdf"
        ) {
            return `assets/${p}`;
        }
        return p;
    });
    const pkg = JSON.parse(fsSync.readFileSync("package.json", "utf8"));
    await generateServiceWorker(OUT_DIR, manifest, pkg.version);
    await fs.copyFile(
        path.join(OUT_DIR, "sw.js"),
        path.join(OUT_DIR, "service-worker.js"),
    );
    let finalHtml = await fs.readFile(`${OUT_DIR}/index.html`, 'utf8');
    finalHtml = applyCsp(finalHtml, cspBase);
    await fs.writeFile(`${OUT_DIR}/index.html`, finalHtml);
    await checkGzipSize(`${OUT_DIR}/insight.bundle.js`);
    if (process.env.W3UP_EMAIL) {
        const client = await w3up.create();
        const account = await client.login(process.env.W3UP_EMAIL);
        const space = await client.createSpace('insight-build', { account });
        await client.setCurrentSpace(space.did());
        const files = await Promise.all(
            [
                'index.html',
                'insight.bundle.js',
                'assets/d3.v7.min.js',
                'assets/lib/bundle.esm.min.js',
            ].map(async (f) => new File([await fs.readFile(`${OUT_DIR}/${f}`)], f)),
        );
        const cid = await client.uploadDirectory(files);
        await fs.writeFile(`${OUT_DIR}/CID.txt`, cid.toString());
        if (verbose) {
            console.log('Pinned CID:', cid.toString());
        }
    }
}

bundle().catch((err) => {
    console.error(err);
    process.exit(1);
});
