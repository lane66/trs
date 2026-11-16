const assert=require('node:assert/strict');
const {parseLevel,comparison,aggregate}=require('./static-model.js');
const table=parseLevel('[samples]\na%20one.txt\tok\t6\nb.txt\tok\t0\nc.txt\tmissing_section\t\nd.txt\tinvalid_data\t\ne.txt\tok\t7\n[features]\ngene%2FA\t0:2\t4:7\ngene%20B\t0:4');
assert.match(comparison(table,'gene/A'),/a%20one.txt\t2\tok/);
assert.match(comparison(table,'gene/A'),/b.txt\t0\tok/);
assert.match(comparison(table,'gene/A'),/c.txt\t\tmissing_section/);
assert.match(comparison(table,'@total'),/a%20one.txt\t6\tok/);
const cohort=[{file:'a one.txt',cells:10},{file:'b.txt',cells:30},{file:'c.txt',cells:100},{file:'d.txt',cells:1},{file:'e.txt',cells:0}];
assert.deepEqual(aggregate(table,cohort),{features:[['gene B',1],['gene/A',0.5]],total:1.5,totalCells:40,usedSamples:2,totalSamples:5,excludedSamples:3});
assert.equal(aggregate(table,[{file:'e.txt',cells:'NaN'}]).total,null);
assert.equal(aggregate(table,[{file:'e.txt',cells:-1}]).usedSamples,0);
assert.equal(aggregate(table,[{file:'e.txt',cells:Infinity}]).usedSamples,0);
assert.equal(aggregate(table,[{file:'e.txt',cells:1e308}]).usedSamples,0);
assert.equal(aggregate(table,[cohort[0],cohort[0]]).totalSamples,1);
assert.deepEqual(aggregate(table,[]).features,[]);
console.log('PASS: static comparison and aggregation preserve valid zeros, missing/invalid sections, encoded names, coverage and cell weights.');
// Optional real-data parity cases supplied by validate-static.py.
if(process.argv[2]){
 const fs=require('node:fs'),path=require('node:path');
 const cases=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'dist/static-index/manifest.json'),'utf8'));
 const close=(a,b,label)=>assert.ok(a===b||Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-11*Math.max(1e-12,Math.abs(b)),`${label}: ${a} != ${b}`);
 for(const level of ['gene','subtype','type']){
  const index=parseLevel(fs.readFileSync(path.join(__dirname,'dist/static-index',manifest.levels[level]),'utf8'));
  for(const test of cases[level]){
   const actual=aggregate(index,test.samples),expected=test.expected;
   for(const key of ['usedSamples','totalSamples','excludedSamples'])assert.equal(actual[key],expected[key]);
   for(const key of ['total','totalCells'])close(actual[key],expected[key],key);
   assert.equal(actual.features.length,expected.features.length);
   const features=new Map(actual.features);
   for(const [name,value] of expected.features)close(features.get(name),value,name);
  }
 }
 console.log('PASS: static gene/subtype/type aggregates match Python source-index results for every feature in all test cohorts.');
}
