const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {parseSample,parseMetadata,total}=require('./data-loader.js');
const dataDir=path.resolve(__dirname,'data');
const files=fs.readdirSync(dataDir).filter(f=>f.endsWith('.txt')).sort();
const metadata=execFileSync('python3',['-c','from server import DATA_DIR, ROOT; from index_store import AtlasIndex; import sys; index=AtlasIndex(DATA_DIR, ROOT / ".cache" / "atlas.sqlite"); sys.stdout.buffer.write(index.response("metadata")); index.close()'],{cwd:__dirname,maxBuffer:10*1024*1024}).toString('utf8');
const samples=parseMetadata(metadata);
assert.equal(samples.length,files.length);
let count=0;
for(const [index,file] of files.entries()){
  const text=fs.readFileSync(path.join(dataDir,file),'utf8');
  const result=parseSample(text,file,index);
  assert.deepEqual(samples[index],result.sample,`Metadata mismatch: ${file}`);
  for(const level of ['gene','subtype','type']){
    const section=text.split(`[${level}]`)[1]?.split(/\n\[/)[0]??'';
    const expected=new Map();
    for(const row of section.trim().split(/\r?\n/).filter(Boolean)){
      const [name,value]=row.split('\t');expected.set(name,(expected.get(name)||0)+Number(value));
    }
    assert.deepEqual(new Map(result.profiles[level]),expected,`Abundance mismatch: ${file} ${level}`);
    assert.ok(Number.isFinite(total(result.profiles[level])));
    count+=expected.size;
  }
}
const empty=parseSample('[metadata]\nSample\nlat\tnan\nlong\nbiome\n[gene]\na\t1\na\t2\n','empty.txt');
assert.equal(empty.sample.id,'empty');assert.equal(empty.sample.biome,'Unknown');assert.equal(empty.sample.coords,null);
assert.deepEqual(empty.profiles.gene,[['a',3]]);
for(const value of ['NaN','-1','Infinity',''])assert.throws(()=>parseSample(`[gene]\na\t${value}`,'bad.txt'));
assert.equal(parseSample('[metadata]\nlat\t\nlong\t\n','missing.txt').sample.coords,null);
console.log(`PASS: ${files.length} original text files, ${count.toLocaleString()} abundance values, exact metadata and value matching; parser edge cases passed.`);
