#!/usr/bin/env node
// Lists every tr("…") key in src/ and checks the catalogs against them.
//   node scripts/i18n-keys.mjs           write src/i18n/keys.json (Chinese) and keys-en.json (English)
//   node scripts/i18n-keys.mjs --check   fail when a catalog misses a key or drops a placeholder/mention
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const HAN = /[㐀-鿿]/;
// Tokens the app parses inside text; translations must keep them verbatim.
const TOKENS = /\{\d+\}|\{[A-Za-z_]\w*\}|\{\{[^}]+\}\}|@(?:图片|视频|音频|文本|区域)(?:\d+|\{\d+\})/g;

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
    }
    return out;
}

const keys = new Set();
for (const file of walk(srcDir, [])) {
    const source = fs.readFileSync(file, "utf8");
    if (!/\b(tr|trI18n)\(/.test(source)) continue;
    const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx", "decorators-legacy"] });
    traverse(ast, {
        CallExpression(p) {
            const { callee, arguments: args } = p.node;
            if (callee.type === "Identifier" && (callee.name === "tr" || callee.name === "trI18n" || callee.name === "trParts") && args[0]?.type === "StringLiteral") keys.add(args[0].value);
            if (callee.type === "Identifier" && callee.name === "trIn" && args[0]?.type === "StringLiteral" && args[1]?.type === "StringLiteral") keys.add(`${args[1].value}@${args[0].value}`);
        },
    });
}
const chinese = [...keys].filter((key) => HAN.test(key)).sort();
const english = [...keys].filter((key) => !HAN.test(key)).sort();

if (!process.argv.includes("--check")) {
    fs.writeFileSync(path.join(srcDir, "i18n/keys.json"), JSON.stringify(chinese, null, 2) + "\n");
    fs.writeFileSync(path.join(srcDir, "i18n/keys-en.json"), JSON.stringify(english, null, 2) + "\n");
    console.log(`${chinese.length} Chinese keys, ${english.length} English keys`);
} else {
    // A placeholder may repeat in one language and not the other ("第 {0} {1}，共 {2} {1}"), so compare the distinct set.
    const tokens = (text) => [...new Set(text.match(TOKENS) || [])].sort().join(" ");
    let problems = 0;
    for (const locale of ["en", "pt-BR"]) {
        const catalog = JSON.parse(fs.readFileSync(path.join(srcDir, `i18n/locales/${locale}.json`), "utf8"));
        const required = locale === "en" ? chinese : [...chinese, ...english];
        for (const key of required) {
            const value = catalog[key];
            if (!value) {
                problems++;
                if (problems <= 20) console.log(`${locale}: missing ${JSON.stringify(key)}`);
            } else if (tokens(key) !== tokens(value) || HAN.test(value.replace(TOKENS, ""))) {
                problems++;
                if (problems <= 20) console.log(`${locale}: placeholders or Chinese left in ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
            }
        }
    }
    console.log(problems ? `${problems} problems` : "catalogs cover every key");
    process.exit(problems ? 1 : 0);
}
