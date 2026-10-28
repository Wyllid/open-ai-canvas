#!/usr/bin/env node
// Wraps user-visible Chinese text in src/ with the i18n translate function `tr`.
//
//   node scripts/i18n-codemod.mjs --dry-run   list the keys it would create (src/i18n/keys.json)
//   node scripts/i18n-codemod.mjs             rewrite the files and refresh src/i18n/keys.json
//
// The Chinese source text is the catalog key; template literals become "{0}" placeholders.
// Text that reaches a model (prompts, instructions, templates), comparisons, object keys,
// types and tagged templates are left alone. Files listed in LABEL_ONLY_FILES mix labels
// with prompt text, so only label-like properties are wrapped there.
// Edits are applied to the original text by position, so formatting is never reprinted.
// Run it twice: the second pass wraps text interpolated into keys created by the first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const dryRun = process.argv.includes("--dry-run");
const only = process.argv.filter((arg) => arg.startsWith("--only=")).map((arg) => arg.slice(7));
// --english wraps English UI text instead (screens the fork wrote in English); the English
// text is then the key, and only pt-BR needs a translation.
const english = process.argv.includes("--english");

const HAN = /[㐀-鿿]/;
// English UI text: has a word, no Han, is not a camelCase identifier, path, class list or token.
const looksLikeEnglishText = (value) => {
    const text = value.trim();
    if (!/[A-Za-z]{2}/.test(text) || HAN.test(text)) return false;
    if (/^[a-z]+[A-Z]\w*$/.test(text) || /^[\w./:-]+\/[\w./:-]*$/.test(text) || /^[a-z0-9_-]+$/.test(text)) return false;
    if (/^([a-z0-9:[\]/.-]+\s+)+[a-z0-9:[\]/.-]+$/.test(text) && /-/.test(text)) return false;
    return /\s/.test(text) || /^[A-Z][a-z]+[.!?…]?$/.test(text);
};
const isText = (value) => (english ? looksLikeEnglishText(value) : HAN.test(value));
const PROMPT_NAME = /prompt|instruction|template|system(Message|Text)?$|negative|suffix|prefix/i;
const LABEL_KEY = /^(label|labels|name|title|description|desc|hint|placeholder|tooltip|summary|subtitle|caption|tag|tags|category|group|groupLabel|empty|message|helper|note|shortLabel|display|displayName|text)$/i;
const SKIP_CALLEES = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "replace", "replaceAll", "split", "match", "matchAll", "search", "test", "RegExp", "localeCompare", "has", "get", "set", "delete", "querySelector", "querySelectorAll", "getItem", "setItem", "removeItem", "require", "t", "translate"]);
const TRANSLATE_FNS = new Set(["tr", "trI18n"]);
const NON_TEXT_ATTRS = /^(className|key|id|href|src|type|name|value|role|data-|style|defaultValue|htmlFor|accept|pattern|rel|target)/;
const SKIP_DIRS = [path.join(srcDir, "i18n")];
// Files whose strings are mostly prompts sent to models: only label-like values are wrapped.
const LABEL_ONLY_FILES = new Set(
    [
        "lib/drama/drama-styles.ts",
        "lib/canvas/canvas-style-system.ts",
        "lib/canvas/camera-prompt-library.ts",
        "lib/plugins/builtin/prompt-optimizer.ts",
        "lib/prompts/catalog.ts",
        "lib/prompts/short-drama-outline.ts",
        "lib/prompts/operations.ts",
        "lib/canvas/previs/previs-prompt-compiler.ts",
        "lib/canvas/previs/previs-templates.ts",
        "lib/canvas/previs/previs-scene.ts",
        "lib/drama/asset-prompt.ts",
        "lib/image-reference-prompt.ts",
        "lib/inspirations/catalog.ts",
        "pages/canvas/list-mode-generator.ts",
        "lib/creation/creative-agent-contract.ts",
        "lib/creation/creative-agent-tools.ts",
        "services/creative-agent-controller.ts",
        "lib/canvas/image-to-previs-agent.ts",
        "lib/canvas/skill-drafting.ts",
    ].map((file) => path.join(srcDir, file)),
);

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.includes(full)) walk(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out;
}

function keyName(node) {
    if (!node) return "";
    if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name;
    if (node.type === "StringLiteral") return node.value;
    if (node.type === "JSXNamespacedName") return `${node.namespace.name}:${node.name.name}`;
    return "";
}

function calleeName(callee) {
    if (!callee) return "";
    if (callee.type === "Identifier") return callee.name;
    if (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") return keyName(callee.property);
    return "";
}

const PROPERTY_TYPES = new Set(["ObjectProperty", "ObjectMethod", "ClassProperty", "TSPropertySignature"]);
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"]);

// Decides whether a string-ish node at `p` is user-visible text we may translate.
function translatable(p, labelOnly) {
    let child = p;
    let parent = p.parentPath;
    let labelKeySeen = false;
    for (let depth = 0; parent && depth < 14; depth++, child = parent, parent = parent.parentPath) {
        const node = parent.node;
        const type = node.type;
        if (type === "ImportDeclaration" || type === "ExportAllDeclaration" || (type === "ExportNamedDeclaration" && child.key === "source")) return false;
        if (type === "TSLiteralType" || type === "TSEnumMember" || type === "TSTypeAnnotation" || type === "TSImportType") return false;
        if (type === "TaggedTemplateExpression") return false;
        if (type === "SwitchCase" && child.key === "test") return false;
        if (type === "BinaryExpression" && ["===", "!==", "==", "!=", "in", "instanceof"].includes(node.operator)) return false;
        if (PROPERTY_TYPES.has(type)) {
            if (child.key === "key" && !node.computed) return false;
            const key = keyName(node.key);
            if (PROMPT_NAME.test(key)) return false;
            if (LABEL_KEY.test(key)) labelKeySeen = true;
            if (labelOnly && depth === 0 && !LABEL_KEY.test(key)) return false;
        }
        if (type === "VariableDeclarator" && PROMPT_NAME.test(keyName(node.id))) return false;
        if (type === "AssignmentExpression") {
            const target = node.left;
            const name = target.type === "MemberExpression" ? keyName(target.property) : keyName(target);
            if (PROMPT_NAME.test(name)) return false;
        }
        if (type === "CallExpression" || type === "NewExpression" || type === "OptionalCallExpression") {
            const name = calleeName(node.callee);
            // Already wrapped: the key stays, values interpolated into it may still be text.
            if (TRANSLATE_FNS.has(name)) {
                if (child.key === 0 && child.listKey === "arguments") return false;
                continue;
            }
            if (SKIP_CALLEES.has(name) || PROMPT_NAME.test(name)) return false;
            if ((node.callee.type === "MemberExpression" || node.callee.type === "OptionalMemberExpression") && keyName(node.callee.object) === "console") return false;
        }
        if (FUNCTION_TYPES.has(type)) {
            if (PROMPT_NAME.test(keyName(node.id)) || PROMPT_NAME.test(keyName(node.key))) return false;
            const holder = parent.parentPath?.node;
            if (holder && holder.type === "VariableDeclarator" && PROMPT_NAME.test(keyName(holder.id))) return false;
            if (holder && PROPERTY_TYPES.has(holder.type) && PROMPT_NAME.test(keyName(holder.key))) return false;
            break;
        }
        if (type === "JSXAttribute") {
            const attr = keyName(node.name);
            // value/name on a component (not a native input) may hold text nested in an expression.
            const element = keyName(parent.parentPath?.node?.name);
            const nativeElement = /^[a-z]/.test(element);
            if (NON_TEXT_ATTRS.test(attr) && (depth === 0 || nativeElement || !/^(value|defaultValue|name)$/.test(attr))) return false;
            break;
        }
        if (type === "Program") break;
    }
    if (labelOnly && !labelKeySeen) return false;
    return true;
}

function transformFile(file, keys) {
    const source = fs.readFileSync(file, "utf8");
    if (!english && !HAN.test(source)) return null;
    const labelOnly = LABEL_ONLY_FILES.has(file);
    let ast;
    try {
        ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx", "decorators-legacy"], errorRecovery: false });
    } catch (error) {
        console.warn(`skip (parse error) ${path.relative(root, file)}: ${error.message}`);
        return null;
    }
    let fnName = "tr";
    let imported = false;
    for (const statement of ast.program.body) {
        if (statement.type === "ImportDeclaration" && statement.source.value === "@/i18n") {
            const spec = statement.specifiers.find((item) => item.type === "ImportSpecifier" && keyName(item.imported) === "tr");
            if (spec) {
                fnName = spec.local.name;
                imported = true;
            }
        }
    }
    if (!imported) {
        let collision = false;
        traverse(ast, {
            Identifier(p) {
                if (p.node.name === "tr") collision = true;
            },
        });
        if (collision) fnName = "trI18n";
    }
    const edits = [];
    const record = (key, start, end, text) => {
        keys.set(key, (keys.get(key) || 0) + 1);
        edits.push({ start, end, text });
    };
    const call = (key, args = []) => `${fnName}(${[JSON.stringify(key), ...args].join(", ")})`;
    traverse(ast, {
        StringLiteral(p) {
            const value = p.node.value;
            if (!isText(value) || !translatable(p, labelOnly)) return;
            const text = p.parentPath.node.type === "JSXAttribute" ? `{${call(value)}}` : call(value);
            record(value, p.node.start, p.node.end, text);
            p.skip();
        },
        TemplateLiteral(p) {
            const quasis = p.node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw);
            if (!(english ? looksLikeEnglishText(quasis.join(" x ")) : quasis.some((q) => HAN.test(q))) || quasis.some((q) => /[{}]/.test(q)) || !translatable(p, labelOnly)) return;
            const key = quasis.map((q, i) => (i < quasis.length - 1 ? `${q}{${i}}` : q)).join("");
            const args = p.node.expressions.map((expression) => source.slice(expression.start, expression.end));
            record(key, p.node.start, p.node.end, call(key, args));
            p.skip();
        },
        JSXText(p) {
            const raw = source.slice(p.node.start, p.node.end);
            if (!isText(raw) || labelOnly || /[&{}<>]/.test(raw)) return;
            const text = raw.replace(/\s+/g, " ").trim();
            const lead = raw.match(/^\s*/)[0];
            const trail = raw.match(/\s*$/)[0];
            record(text, p.node.start, p.node.end, `${lead}{${call(text)}}${trail}`);
        },
    });
    if (!edits.length) return null;
    edits.sort((a, b) => b.start - a.start);
    let output = source;
    let lastStart = Infinity;
    for (const edit of edits) {
        if (edit.end > lastStart) continue; // nested edit already covered by an outer one
        output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
        lastStart = edit.start;
    }
    if (!imported) {
        const importLine = fnName === "tr" ? `import { tr } from "@/i18n";\n` : `import { tr as trI18n } from "@/i18n";\n`;
        const directive = output.match(/^(\s*(["'])use (client|strict)\2;?\s*\n)/);
        output = directive ? directive[1] + importLine + output.slice(directive[1].length) : importLine + output;
    }
    return { output, changed: edits.length };
}

const keys = new Map();
const files = walk(srcDir, []).filter((file) => !only.length || only.some((part) => file.includes(part)));
let filesChanged = 0;
let replacements = 0;
for (const file of files) {
    const result = transformFile(file, keys);
    if (!result) continue;
    filesChanged++;
    replacements += result.changed;
    if (!dryRun) fs.writeFileSync(file, result.output);
}
const keysFile = path.join(srcDir, "i18n", english ? "keys-en.json" : "keys.json");
fs.mkdirSync(path.dirname(keysFile), { recursive: true });
const existing = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, "utf8")) : [];
const merged = [...new Set([...existing, ...keys.keys()])].sort();
fs.writeFileSync(keysFile, JSON.stringify(merged, null, 2) + "\n");
console.log(`${dryRun ? "[dry-run] " : ""}${filesChanged} files, ${replacements} replacements, ${keys.size} unique keys (${merged.length} in keys.json)`);
