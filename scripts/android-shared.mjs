import ts from 'typescript';
import { readFileSync } from 'node:fs';

// 构建时取出原模块的纯声明及其依赖，官方提取正则与成本规则只维护一份。
export function extractAndroidShared(file, exports, imports = '', overrides = {}) {
  const source = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = new Map();
  for (const statement of tree.statements) {
    const names = ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap(item => ts.isIdentifier(item.name) ? [item.name.text] : [])
      : (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name ? [statement.name.text] : [];
    for (const name of names) declarations.set(name, statement);
  }
  const selected = new Set();
  function include(name) {
    const node = declarations.get(name);
    if (!node) throw new Error(`Android 共用声明缺失：${name}`);
    if (selected.has(node)) return;
    selected.add(node);
    if (Object.hasOwn(overrides, name)) return;
    function visit(child) { if (ts.isIdentifier(child) && declarations.has(child.text)) include(child.text); ts.forEachChild(child, visit); }
    ts.forEachChild(node, visit);
  }
  exports.forEach(include);
  return imports + '\n' + tree.statements.filter(node => selected.has(node)).map(node => {
    const name = [...declarations].find(([, value]) => value === node)?.[0];
    return Object.hasOwn(overrides, name) ? overrides[name] : node.getText(tree).replace(/^export\s+/, '');
  }).join('\n') + `\nexport { ${exports.join(', ')} };\n`;
}
