const assert=require('node:assert/strict');
const {normalize,parseValues,ranked}=require('./comparison.js');
const values=parseValues('file\tabundance\tstatus\na.txt\t0.3\tok\nb.txt\t0\tok\nc.txt\t\tmissing_section\nd.txt\t0.3\tok\ne.txt\t\tinvalid_data\n');
assert.equal(values.get('b.txt').value,0);
assert.equal(values.get('c.txt').value,null);
assert.equal(values.get('e.txt').value,null);
const samples=['a','b','c','d','e'].map(id=>({id,file:id+'.txt'}));
assert.deepEqual(ranked(samples,values).map(row=>[row.sample.id,row.rank]),[['a',1],['d',1],['b',3],['c',null],['e',null]]);
assert.deepEqual(ranked(samples.filter(s=>s.id==='b'||s.id==='d'),values).map(row=>[row.sample.id,row.rank]),[['d',1],['b',2]]);
assert.equal(normalize('beta-lactam'),normalize('beta_lactam'));
assert.equal(normalize('β lactam'),normalize('beta_lactam'));
console.log('PASS: zero versus unavailable, abundance ranking, equal-value ranks, filtered re-ranking, and feature search normalization.');

// Biome filters recalculate weighted abundance without renormalizing other sites.
const {locationKey,siteAbundanceScale,weightedAbundance}=require('./comparison.js');
const spatialSamples=[
  {id:'high',file:'high',metadata:{nCell:'1'},biome:'AS',coords:[22.4,114.1]},
  {id:'shared-low',file:'shared-low',metadata:{nCell:'3'},biome:'FW',coords:[22.4,114.1]},
  {id:'low',file:'low',metadata:{nCell:'10'},biome:'FW',coords:[22.3,114.2]},
  {id:'missing',file:'missing',metadata:{nCell:'10'},biome:'FW',coords:[22.2,114.3]},
  {id:'unmapped',file:'unmapped',metadata:{nCell:'10'},biome:'FW',coords:null}
];
const spatialValues=new Map([['high',{value:100}],['shared-low',{value:0}],['low',{value:6.25}],['missing',{value:null}],['unmapped',{value:1e6}]]);
const scale=siteAbundanceScale(spatialSamples,spatialValues);
assert.equal(scale.size,3);
assert.equal(scale.get(locationKey(spatialSamples[0])).diameter,20);
assert.equal(scale.get(locationKey(spatialSamples[2])).diameter,17);
assert.equal(scale.get(locationKey(spatialSamples[3])).diameter,14);
assert.equal(scale.get(locationKey(spatialSamples[3])).value,null);
const fwScale=siteAbundanceScale(spatialSamples,spatialValues,new Set(['FW']));
const asScale=siteAbundanceScale(spatialSamples,spatialValues,new Set(['AS']));
assert.equal(scale.get(locationKey(spatialSamples[1])).value,25);
assert.equal(fwScale.get(locationKey(spatialSamples[1])).value,0);
assert.equal(fwScale.get(locationKey(spatialSamples[1])).diameter,14);
assert.equal(asScale.get(locationKey(spatialSamples[0])).value,100);
assert.equal(asScale.get(locationKey(spatialSamples[0])).diameter,26);
assert.equal(fwScale.get(locationKey(spatialSamples[2])).diameter,scale.get(locationKey(spatialSamples[2])).diameter);
assert.equal(siteAbundanceScale(spatialSamples,spatialValues,new Set()).size,0);
console.log('PASS: biome selection updates shared-site cell-weighted sizes, retains valid zeros, and preserves the reference scale for other sites.');

const weightedSamples=[
  {file:'a',metadata:{nCell:'10',cpg:'999'}},
  {file:'b',metadata:{nCell:'30',cpg:'999'}},
  {file:'zero',metadata:{nCell:'10'}},
  {file:'missing-abundance',metadata:{nCell:'1000'}},
  {file:'missing-cells',metadata:{}},
  {file:'zero-cells',metadata:{nCell:'0'}},
  {file:'negative-cells',metadata:{nCell:'-1'}},
  {file:'invalid-cells',metadata:{nCell:'not-a-number'}}
];
const weightedValues=new Map(weightedSamples.map(s=>[s.file,{value:100}]));
weightedValues.set('a',{value:1});weightedValues.set('b',{value:3});
weightedValues.set('zero',{value:0});weightedValues.set('missing-abundance',{value:null});
const two=weightedAbundance(weightedSamples.slice(0,2),weightedValues);
assert.equal(two.value,2.5); // (1*10 + 3*30)/(10+30), not mean 2 or max 3.
assert.equal(two.totalCopies,100);assert.equal(two.totalCells,40);
const all=weightedAbundance(weightedSamples,weightedValues);
assert.equal(all.value,2); // Valid zeros contribute cells to the denominator.
assert.equal(all.totalCells,50);assert.equal(all.usedSamples,3);assert.equal(all.excludedSamples,5);
assert.equal(weightedAbundance(weightedSamples.slice(3),weightedValues).value,null);
assert.equal(weightedAbundance([],weightedValues).value,null);
console.log('PASS: cell-weighted aggregation, valid zeros, invalid weights, unavailable values, and metadata cpg excluded from the formula.');

const {parseTypeMatrix}=require('./comparison.js');
const matrix=parseTypeMatrix('file\tstatus\t@total\tbeta_lactam\tother%20type\na%20b.txt\tok\t0.375\t0.125\t0.25\nzero.txt\tok\t0\t0\t0\nmissing.txt\tmissing_section\t\t\t\ninvalid.txt\tinvalid_data\t\t\t');
assert.deepEqual([...matrix.keys()],['@total','beta_lactam','other type']);
assert.equal(matrix.get('beta_lactam').get('a b.txt').value,0.125);
assert.equal(matrix.get('@total').get('zero.txt').value,0);
assert.deepEqual(matrix.get('other type').get('missing.txt'),{value:null,status:'missing_section'});
assert.deepEqual(matrix.get('@total').get('invalid.txt'),{value:null,status:'invalid_data'});
console.log('PASS: preloaded type matrix preserves precision, encoded names, zero values, and unavailable statuses.');

const {pointInGeometry}=require('./comparison.js');
const square=[[0,0],[10,0],[10,10],[0,10],[0,0]];
const hole=[[3,3],[7,3],[7,7],[3,7],[3,3]];
const polygon={type:'Polygon',coordinates:[square,hole]};
assert.equal(pointInGeometry([2,2],polygon),true);
assert.equal(pointInGeometry([5,5],polygon),false);
assert.equal(pointInGeometry([11,5],polygon),false);
assert.equal(pointInGeometry([0,5],polygon),true);
assert.equal(pointInGeometry([3,5],polygon),true);
assert.equal(pointInGeometry([0,0],polygon),true);
const island=[[20,30],[21,30],[21,31],[20,31],[20,30]];
assert.equal(pointInGeometry([30.5,20.5],{type:'MultiPolygon',coordinates:[[square,hole],[island]]}),true);
assert.equal(pointInGeometry([20.5,30.5],{type:'MultiPolygon',coordinates:[[square,hole],[island]]}),false);
assert.equal(pointInGeometry(null,polygon),false);
console.log('PASS: district membership includes edges and islands, excludes holes, and uses latitude/longitude correctly.');

const fullDistricts=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'assets/districts.geojson'),'utf8')).features;
const landDistricts=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'assets/districts-land.geojson'),'utf8')).features;
assert.deepEqual(fullDistricts.map(f=>f.properties.District).sort(),landDistricts.map(f=>f.properties.District).sort());
for(const [name,coords] of [['Sai Kung District',[22.3873666666667,114.28575]],['Tai Po District',[22.44385,114.241766666667]],['North District',[22.5497333333333,114.23785]]]){
  assert.equal(pointInGeometry(coords,fullDistricts.find(f=>f.properties.District===name).geometry),true);
  assert.equal(landDistricts.some(f=>pointInGeometry(coords,f.geometry)),false);
  assert.equal(fullDistricts.filter(f=>pointInGeometry(coords,f.geometry)).length,1);
}
console.log('PASS: marine PM1, TM6, and MM1 sites belong to their full administrative districts despite being outside land polygons.');
