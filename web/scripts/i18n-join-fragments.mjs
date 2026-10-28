// Joins JSX runs like {tr("共")} {n} {tr("条")} into one sentence: {tr("共 {0} 条", n)}.
// Usage: node scripts/i18n-join-fragments.mjs [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default || traverseModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const dryRun = process.argv.includes("--dry-run");

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx$/.test(entry.name)) out.push(full);
    }
    return out;
}

function trLiteral(child) {
    if (child.type !== "JSXExpressionContainer") return null;
    const call = child.expression;
    if (call.type !== "CallExpression" || call.callee.type !== "Identifier" || call.callee.name !== "tr") return null;
    if (call.arguments.length !== 1 || call.arguments[0].type !== "StringLiteral") return null;
    return call.arguments[0].value;
}

function plainExpression(child) {
    if (child.type !== "JSXExpressionContainer" || child.expression.type === "JSXEmptyExpression") return false;
    let jsx = false;
    traverse.cheap(child.expression, (node) => {
        if (node.type === "JSXElement" || node.type === "JSXFragment") jsx = true;
    });
    return !jsx;
}

const found = [];
for (const file of walk(root)) {
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes("tr(")) continue;
    const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    const edits = [];
    traverse(ast, {
        "JSXElement|JSXFragment"(p) {
            const children = p.node.children;
            let i = 0;
            while (i < children.length) {
                if (trLiteral(children[i]) === null) {
                    i++;
                    continue;
                }
                // Grow a run of tr / short inline text / plain expressions that ends on a tr call.
                let j = i,
                    last = i,
                    exprCount = 0,
                    lastExprCount = 0;
                while (j + 1 < children.length) {
                    const next = children[j + 1];
                    const isText = next.type === "JSXText" && !next.value.includes("\n") && next.value.length <= 2 && !next.value.trim();
                    if (trLiteral(next) !== null) {
                        j++;
                        last = j;
                        lastExprCount = exprCount;
                        continue;
                    }
                    if (isText) {
                        j++;
                        continue;
                    }
                    if (plainExpression(next)) {
                        j++;
                        exprCount++;
                        continue;
                    }
                    break;
                }
                // A count right before the first fragment belongs to the sentence too: {n}{tr("个图形 ·")}…
                let first = i;
                const before = children[i - 1];
                if (before && plainExpression(before)) {
                    first = i - 1;
                    lastExprCount++;
                } else if (before && before.type === "JSXText" && !before.value.includes("\n") && before.value.length <= 2 && !before.value.trim() && children[i - 2] && plainExpression(children[i - 2])) {
                    first = i - 2;
                    lastExprCount++;
                }
                if (first < i && edits.some((edit) => edit.end > children[first].start)) {
                    first = i;
                    lastExprCount--;
                }
                if ((last > i && lastExprCount > 0) || (first < i && lastExprCount > 0)) {
                    let template = "";
                    const args = [];
                    for (let k = first; k <= last; k++) {
                        const child = children[k];
                        const literal = trLiteral(child);
                        if (literal !== null) template += literal;
                        else if (child.type === "JSXText") template += child.value;
                        else {
                            template += `{${args.length}}`;
                            args.push(source.slice(child.expression.start, child.expression.end));
                        }
                    }
                    const replacement = `{tr(${JSON.stringify(template)}, ${args.join(", ")})}`;
                    edits.push({ start: children[first].start, end: children[last].end, replacement, template });
                    i = last + 1;
                } else i++;
            }
        },
    });
    if (!edits.length) continue;
    let next = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end);
    for (const edit of edits) found.push({ file: path.relative(root, file), template: edit.template, replacement: edit.replacement });
    if (!dryRun) fs.writeFileSync(file, next);
}
for (const item of found) console.log(`${item.file}\t${item.template}\t${item.replacement}`);
console.error(`${dryRun ? "[dry-run] " : ""}${found.length} runs joined`);
