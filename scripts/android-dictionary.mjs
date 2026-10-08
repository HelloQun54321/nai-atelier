import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { extractAndroidShared } from './android-shared.mjs';

export function androidDictionaryGenerator(file) {
  const tree=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const main=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='main');
  const block=main.body.statements.find(ts.isTryStatement).tryBlock;
  const statements=[];
  let recording=false;
  for(const node of block.statements){
    const text=node.getText(tree);
    if(text.startsWith('const categoryCounts'))recording=true;
    if(!recording)continue;
    if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['rows','naiConfig'].includes(d.name.getText(tree))))continue;
    if(text.startsWith('await rm(')||text.startsWith('OUTPUT_DIR ='))continue;
    statements.push(text);
    if(text.startsWith('await writeFile(path.join(OUTPUT_DIR, \'manifest.json\')'))break;
  }
  if(!statements.at(-1)?.includes("'manifest.json'"))throw new Error('Android 词库生成器未找到完整 manifest 写入');
  return extractAndroidShared(file,['writeShards','writeArtistPages','writeCharacterSearchShards','categoryNames','normalizeTag','normalizeChinese','TRANSLATION_PROJECT_URL','TRANSLATION_DATABASE_URL'],
    `import path from 'path-browserify';
import {mkdir,writeFile} from '/mobile/dictionary';`,{OUTPUT_DIR:'let OUTPUT_DIR;'})
    + `\nexport async function generate(rows,naiConfig,sourceMetadata,directory){OUTPUT_DIR=directory;${statements.join('\n')}return manifest;}`;
}
