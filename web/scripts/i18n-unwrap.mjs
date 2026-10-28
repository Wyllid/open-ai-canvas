#!/usr/bin/env node
// Undoes tr() wrapping for text that reaches a model, restoring the original literal.
//   node scripts/i18n-unwrap.mjs <file> [--match=<regex on the key>]
// Without --match every tr() call in the file is unwrapped.
import fs from "node:fs";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const [file, ...rest] = process.argv.slice(2);
const matchArg = rest.find((arg) => arg.startsWith("--match="));
const match = matchArg ? new RegExp(matchArg.slice(8), "s") : null;
const source = fs.readFileSync(file, "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
const edits = [];
traverse(ast, {
    CallExpression(p) {
        const callee = p.node.callee;
        if (callee.type !== "Identifier" || !["tr", "trI18n"].includes(callee.name)) return;
        const [first, ...args] = p.node.arguments;
        if (!first || first.type !== "StringLiteral" || (match && !match.test(first.value))) return;
        let text;
        if (!args.length) text = JSON.stringify(first.value);
        else {
            const body = first.value
                .replace(/\\/g, "\\\\")
                .replace(/`/g, "\\`")
                .replace(/\$\{/g, "\\${")
                .replace(/\{(\d+)\}/g, (_, index) => "${" + source.slice(args[Number(index)].start, args[Number(index)].end) + "}");
            text = "`" + body + "`";
        }
        const inAttribute = p.parentPath.node.type === "JSXExpressionContainer" && p.parentPath.parentPath.node.type === "JSXAttribute" && !args.length;
        edits.push(inAttribute ? { start: p.parentPath.node.start, end: p.parentPath.node.end, text } : { start: p.node.start, end: p.node.end, text });
        p.skip();
    },
});
edits.sort((a, b) => b.start - a.start);
let output = source;
for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
if (!/\b(tr|trI18n)\(/.test(output.replace(/^import .*$/m, ""))) output = output.replace(/^import \{ tr(?: as trI18n)? \} from "@\/i18n";\n/m, "");
fs.writeFileSync(file, output);
console.log(`${file}: unwrapped ${edits.length}`);
