'use strict';
async function initializeAtlas(){
async function read(url,format='text'){
  if(window.ARGStatic&&url.startsWith('/api/'))return ARGStatic.read(url);
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`Could not read ${url} (HTTP ${response.status}). Reload the page to try again.`);
  return format==='json'?response.json():response.text();
}
const [metadataText,districts,land,boundaryMesh,typeMatrixText,selectionDistricts]=await Promise.all([
  read('/api/metadata'),read('assets/districts-land.geojson','json'),read('assets/land-display.geojson','json'),read('assets/boundary-mesh.geojson','json'),read('/api/type-matrix'),read('assets/districts.geojson','json')
]);
const samples=ARGSource.parseMetadata(metadataText);
const profileCache=new Map();
const aggregateProfileCache=new Map();
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => n === 0 ? '0' : n < 0.001 ? n.toExponential(3) : n.toLocaleString('en-US', {maximumSignificantDigits:5});
const biomes = [...new Set(samples.map(s => s.biome))].sort();
// Use the full alphabetical catalog so filtering never changes a biome's shade.
const colors = Object.fromEntries(biomes.map((biome,index) => {
  const shade=Math.round(32+152*index/Math.max(1,biomes.length-1));
  return [biome,`rgb(${shade},${shade},${shade})`];
}));
let enabled = new Set(biomes), level = 'type', selected = null, selectedLocation = null, visible = [], requestVersion = 0;
const pending = new Map();
let exploring = false, areaMode='district', allDistrictProfile=false;
const mobileLayout=window.matchMedia('(max-width:600px)');
const hoverTooltips=window.matchMedia('(min-width:601px) and (hover:hover) and (pointer:fine)');
let siteScale=new Map(); // Full-dataset values for ambient points; explorer values follow selected biomes.
const comparison={level:'type',feature:'@total',values:new Map(),loading:true,error:null,catalog:[]};
const catalogCache=new Map();
const comparisonCache=new Map();
const comparisonKey=(level,feature)=>JSON.stringify([level,feature]);
const typeComparisons=ARGComparison.parseTypeMatrix(typeMatrixText);
catalogCache.set('type',[...typeComparisons.keys()].filter(name=>name!=='@total'));
for(const [feature,values] of typeComparisons){
  comparisonCache.set(comparisonKey('type',feature),{values,scale:ARGComparison.siteAbundanceScale(samples,values)});
}
let comparisonVersion=0,rankingPage=0,rankingSort={key:'abundance',direction:'desc'};
const metadataKeys=[...new Set(samples.flatMap(s=>Object.keys(s.metadata)))].filter(k=>k&&!['Sample','biome','GPS_Name','lat','long'].includes(k));
const rankingColumns=[['rank','Rank'],['sample','Sample'],['abundance','Abundance (copies / cell)'],['biome','Biome'],['location','Location'],['lat','Latitude'],['long','Longitude'],...metadataKeys.filter(k=>k.toLowerCase()!=='cpg').map(k=>[`meta:${k}`,k])];
function measureLabel(){return comparison.feature==='@total'?`Total ${comparison.level} abundance`:comparison.feature.replaceAll('_',' ');}
function valueFor(sample){return comparison.values.get(sample.file)?.value??null;}
function renderFeatureOptions(){
  const query=ARGComparison.normalize($('comparison-search').value);
  const special=[['@total',`Total ${comparison.level} abundance`]];
  const options=[...special,...comparison.catalog.filter(name=>ARGComparison.normalize(name).includes(query)).map(name=>[name,name])];
  if(!options.some(([value])=>value===comparison.feature))options.push([comparison.feature,`${comparison.feature} (selected)`]);
  $('comparison-feature').innerHTML=options.map(([value,label])=>`<option value="${escapeHtml(value)}" ${value===comparison.feature?'selected':''}>${escapeHtml(label)}</option>`).join('');
}
function renderComparisonTabs(){
  document.querySelectorAll('[data-comparison-level]').forEach(button=>{
    const active=button.dataset.comparisonLevel===comparison.level;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
}
async function changeComparison(nextLevel,nextFeature){
  if(nextLevel===comparison.level&&nextFeature===comparison.feature&&!comparison.loading&&!comparison.error){update();return;}
  const version=++comparisonVersion;
  const cacheKey=comparisonKey(nextLevel,nextFeature),cached=comparisonCache.get(cacheKey);
  if(cached){
    Object.assign(comparison,{level:nextLevel,feature:nextFeature,catalog:catalogCache.get(nextLevel)||[],values:cached.values,loading:false,error:null});
    siteScale=cached.scale;
    renderComparisonTabs();$('comparison-search').value='';
    finishComparison();return;
  }
  // Keep the displayed result intact until the indexed response is ready.
  comparison.loading=true;comparison.error=null;
  $('comparison-feature').disabled=true;
  $('comparison-status').hidden=true;

  try{
    const catalogPromise=catalogCache.has(nextLevel)?Promise.resolve(catalogCache.get(nextLevel)):read(`/api/features?level=${nextLevel}`).then(text=>text.split(/\r?\n/).filter(Boolean).map(decodeURIComponent));
    const [catalog,values]=await Promise.all([catalogPromise,read(`/api/comparison?level=${nextLevel}&feature=${encodeURIComponent(nextFeature)}`)]);
    if(version!==comparisonVersion)return;
    catalogCache.set(nextLevel,catalog);
    Object.assign(comparison,{level:nextLevel,feature:nextFeature,catalog,values:ARGComparison.parseValues(values),loading:false});
    $('comparison-search').value='';
    siteScale=ARGComparison.siteAbundanceScale(samples,comparison.values);
    comparisonCache.set(cacheKey,{values:comparison.values,scale:siteScale});
  }catch(error){if(version!==comparisonVersion)return;comparison.loading=false;comparison.error=error.message;$('comparison-status').textContent=error.message;}
  finishComparison();
}
function finishComparison(){
  renderComparisonTabs();
  $('comparison-status').hidden=!comparison.error;
  $('comparison-status').textContent=comparison.error||'';
  $('map-measure').textContent=measureLabel();
  $('comparison-feature').disabled=false;renderFeatureOptions();update();
}
document.querySelectorAll('[data-comparison-level]').forEach(button=>button.onclick=()=>changeComparison(button.dataset.comparisonLevel,'@total'));
$('comparison-feature').onchange=e=>changeComparison(comparison.level,e.target.value);
$('comparison-search').oninput=renderFeatureOptions;
function rowValue(row,key){
  const s=row.sample;
  if(key==='rank')return row.rank;
  if(key==='abundance')return row.value;
  if(key==='sample')return s.id;
  if(key==='lat'||key==='long')return s.metadata[key];
  if(key.startsWith('meta:'))return s.metadata[key.slice(5)];
  return s[key];
}
function sortedRanking(){
  const rows=ARGComparison.ranked(rankingSamples(),comparison.values);
  const {key,direction}=rankingSort,sign=direction==='asc'?1:-1;
  return rows.sort((a,b)=>{
    const av=rowValue(a,key),bv=rowValue(b,key),am=av===null||av===undefined,bm=bv===null||bv===undefined;
    if(am||bm)return Number(am)-Number(bm);
    const numeric=['rank','abundance','lat','long'].includes(key)||key.startsWith('meta:')&&Number.isFinite(Number(av))&&Number.isFinite(Number(bv));
    const delta=numeric?Number(av)-Number(bv):String(av).localeCompare(String(bv),undefined,{numeric:true});
    return sign*delta||a.sample.id.localeCompare(b.sample.id)||a.sample.file.localeCompare(b.sample.file);
  });
}
function renderRanking(){
  const matching=rankingSamples(),count=matching.length,mapped=matching.filter(s=>s.coords).length;
  $('mapped-count').textContent=mapped.toLocaleString();
  $('site-count').textContent=new Set(matching.filter(s=>s.coords).map(siteKey)).size.toLocaleString();
  renderAreaSelection();
  $('ranking-measure').textContent=`${measureLabel()} · ${comparison.level} level · copies / cell`;
  $('ranking-summary').textContent=`${selectedLocation?locationName(selectedLocation)+' · ':selected!==null?(samples[selected].location||samples[selected].id)+' · ':selectedDistrict?selectedDistrict.feature.properties.District+' · ':''}${count.toLocaleString()} matching samples · ${mapped.toLocaleString()} mapped · ${(count-mapped).toLocaleString()} without coordinates`;
  $('ranking-head').innerHTML='<tr>'+rankingColumns.map(([key,label])=>`<th scope="col" aria-sort="${rankingSort.key===key?(rankingSort.direction==='asc'?'ascending':'descending'):'none'}"><button data-sort="${escapeHtml(key)}">${escapeHtml(label)}${rankingSort.key===key?(rankingSort.direction==='asc'?' ↑':' ↓'):''}</button></th>`).join('')+'</tr>';
  const rows=sortedRanking(),pageSize=$('ranking-page-size').value==='all'?Math.max(1,count):Number($('ranking-page-size').value),pages=Math.max(1,Math.ceil(count/pageSize));
  rankingPage=Math.min(rankingPage,pages-1);const start=rankingPage*pageSize,shown=rows.slice(start,start+pageSize),max=Math.max(0,...rows.map(r=>r.value||0));
  const message=comparison.error||(!count?'No samples match the current filters.':null);
  $('ranking-body').innerHTML=message?`<tr><td colspan="${rankingColumns.length}" class="table-message">${escapeHtml(message)}</td></tr>`:shown.map(row=>`<tr data-sample="${row.sample.index}" class="${row.sample.index===selected?'selected':''}">`+rankingColumns.map(([key])=>{
    const value=rowValue(row,key);
    if(key==='sample')return `<td><button class="sample-link" data-sample-index="${row.sample.index}">${escapeHtml(value)}</button></td>`;
    if(key==='biome')return `<td><span class="swatch" style="background:${colors[row.sample.biome]}"></span> ${escapeHtml(value)}</td>`;
    if(key==='abundance')return `<td class="abundance-cell" title="${row.value===null?escapeHtml(row.status):row.value+' copies / cell'}"><strong>${row.value===null?'N/A':fmt(row.value)}</strong><div class="table-bar"><i style="width:${max&&row.value?row.value/max*100:0}%;background:${colors[row.sample.biome]}"></i></div></td>`;
    if(value===null||value===undefined)return '<td>—</td>';
    const numeric=String(value).trim()!==''&&Number.isFinite(Number(value));
    const display=numeric&&(key==='lat'||key==='long')?Number(value).toFixed(5)
      :numeric&&key.startsWith('meta:')?fmt(Number(value)):value;
    return `<td title="${escapeHtml(value)}">${escapeHtml(display)}</td>`;
  }).join('')+'</tr>').join('');
  const unavailable=rows.filter(row=>row.value===null).length;
  $('ranking-range').textContent=message?'':`${start+1}–${Math.min(start+pageSize,count)} of ${count.toLocaleString()} samples${unavailable?` · ${unavailable} unavailable`:''}`;
  $('ranking-page').textContent=`${rankingPage+1} / ${pages}`;
  $('ranking-prev').disabled=rankingPage===0||!!message;$('ranking-next').disabled=rankingPage+1>=pages||!!message;
  $('export-ranking').disabled=!!message;
}
$('ranking-head').onclick=e=>{const button=e.target.closest('[data-sort]');if(!button)return;const key=button.dataset.sort;rankingSort={key,direction:rankingSort.key===key&&rankingSort.direction==='asc'?'desc':key==='abundance'&&rankingSort.key!==key?'desc':'asc'};rankingPage=0;renderRanking();};
$('ranking-prev').onclick=()=>{rankingPage--;renderRanking();};$('ranking-next').onclick=()=>{rankingPage++;renderRanking();};
$('ranking-page-size').onchange=()=>{rankingPage=0;renderRanking();};
$('ranking-body').onclick=e=>{const button=e.target.closest('[data-sample-index]');if(button){selectSample(Number(button.dataset.sampleIndex));document.querySelector('main').scrollIntoView({behavior:'smooth'});}};
$('export-ranking').onclick=()=>{
  const rows=sortedRanking(),headers=['rank','sample','abundance_copies_per_cell','biome','location','lat','long',...metadataKeys,'source_file','comparison_level','comparison_feature','value_status'];
  const exportKeys=['rank','sample','abundance','biome','location','lat','long',...metadataKeys.map(k=>`meta:${k}`)];
  const lines=[headers,...rows.map(row=>[...exportKeys.map(key=>rowValue(row,key)??''),row.sample.file,comparison.level,comparison.feature,row.status])];
  const csv=lines.map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download=`ARG_ranking_${comparison.level}_${comparison.feature.replace(/[^a-z0-9-]/gi,'_')}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function setProfileVisible(open){
  $('profile-panel').hidden=!open;
  $('toggle-profile').setAttribute('aria-expanded',String(open));
}
function closeProfile(restoreFocus=false){
  for(const entry of markerCache.values())entry.marker.closeTooltip();
  allDistrictProfile=false;
  setProfileVisible(false);requestVersion++;
  if(selected!==null||selectedLocation!==null){
    selected=null;selectedLocation=null;requestVersion++;
    drawPoints();rankingPage=0;renderRanking();
  }
  if(restoreFocus)$('map').focus({preventScroll:true});
}
function dismissProfile(){closeProfile(true);if(selectedDistrict)selectDistrict(null);}
function deselectArea(){
  if(mobileLayout.matches){closeProfile();selectDistrict(null);}
  else selectAllDistricts();
}
$('close-profile').onclick=dismissProfile;
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('profile-panel').hidden){
    dismissProfile();event.preventDefault();
  }
});
const map = L.map('map', {
  zoomControl:false, scrollWheelZoom:false, doubleClickZoom:false,
  touchZoom:false, boxZoom:false, keyboard:false, dragging:false,
  zoomSnap:0, zoomAnimation:false, attributionControl:false
});
map.on('click',()=>{
  if(selected!==null||selectedLocation!==null||selectedDistrict)deselectArea();
});
// The land, edge mesh, and hit areas share one topology. Only the mesh draws
// base outlines; selected districts draw an outline temporarily above it.
L.geoJSON(land, {interactive:false,smoothFactor:0,style:{stroke:false,fillColor:'#ffffff',fillOpacity:1}}).addTo(map);
L.geoJSON(boundaryMesh, {interactive:false,smoothFactor:0,style:{color:'#c2c2c2',weight:1.2,opacity:1,fill:false,lineCap:'round',lineJoin:'round'}}).addTo(map);
let selectedDistrict = null;
const districtSites=new WeakMap();
// Administrative polygons include marine areas and are used only for membership.
// The visible coastlines and selected outline continue to use land-only shapes.
const selectionGeometryByName=new Map(selectionDistricts.features.map(feature=>[feature.properties.District,feature.geometry]));
function highlightedDistrictSites(){
  if(!selectedDistrict)return null;
  if(!districtSites.has(selectedDistrict)){
    const sites=new Map(samples.filter(s=>s.coords).map(s=>[siteKey(s),s.coords]));
    const geometry=selectionGeometryByName.get(selectedDistrict.feature.properties.District);
    districtSites.set(selectedDistrict,new Set([...sites].filter(([,coords])=>ARGComparison.pointInGeometry(coords,geometry)).map(([key])=>key)));
  }
  return districtSites.get(selectedDistrict);
}
function rankingSamples(){
  const sites=highlightedDistrictSites();
  const matching=sites?visible.filter(sample=>sites.has(siteKey(sample))):visible;
  if(selectedLocation!==null)return matching.filter(sample=>siteKey(sample)===selectedLocation);
  if(selected===null)return matching;
  const sample=samples[selected];
  return matching.filter(peer=>sample.coords?siteKey(peer)===siteKey(sample):peer.index===selected);
}
function highlightDistrictPoints(){
  const sites=highlightedDistrictSites();
  for(const [key,entry] of markerCache)entry.marker.getElement()?.classList.toggle('district-highlight',!!sites?.has(key));
}
const districtStyle = {stroke:false,color:'#c2c2c2',weight:1.2,fillColor:'#e8e8e8',fillOpacity:0,dashArray:''};
const selectionTheme=getComputedStyle(document.documentElement);
const selectedDistrictStyle = {stroke:true,color:selectionTheme.getPropertyValue('--selection-color').trim(),weight:parseFloat(selectionTheme.getPropertyValue('--selection-width')),fillColor:'#a8a8a8',fillOpacity:0.18,dashArray:''};
function selectDistrict(layer){
  if(layer&&!exploring)return;
  // Mobile clears the panel; desktop returns to the full filtered aggregate.
  if(layer&&layer===selectedDistrict){deselectArea();return;}
  allDistrictProfile=false;
  if(selectedDistrict){
    selectedDistrict.setStyle(districtStyle);
    selectedDistrict.getElement()?.setAttribute('aria-pressed','false');
  }
  selectedDistrict=layer;
  if(layer){
    selected=null;selectedLocation=null;requestVersion++;drawPoints();
    areaMode='district';
    layer.setStyle(selectedDistrictStyle).bringToFront();
    layer.getElement()?.setAttribute('aria-pressed','true');
  }
  highlightDistrictPoints();
  rankingPage=0;renderRanking();
  if(layer){
    setProfileVisible(true);renderAggregateSummary();renderProfile();
  }else if(selected===null&&selectedLocation===null){
    setProfileVisible(false);requestVersion++;
  }
}
const boundaryLayer = L.geoJSON(districts, {bubblingMouseEvents:false,smoothFactor:0,style:districtStyle,onEachFeature:(feature, layer) => {
  layer.bindTooltip(escapeHtml(feature.properties.District), {sticky:true,className:'district-tooltip',opacity:1});
  layer.on('mouseover', () => {if(exploring&&layer!==selectedDistrict)layer.setStyle({fillOpacity:0.16,color:'#737373'});});
  layer.on('mouseout', () => layer.setStyle(layer===selectedDistrict?selectedDistrictStyle:districtStyle));
  layer.on('click',()=>{closeProfile();selectDistrict(layer);});
  layer.on('add',()=>{
    const path=layer.getElement();
    path.classList.add('district-boundary');
    path.setAttribute('tabindex',exploring?'0':'-1');
    path.setAttribute('aria-hidden',String(!exploring));
    path.setAttribute('role','button');
    path.setAttribute('aria-label',`Select ${feature.properties.District}`);
    path.setAttribute('aria-pressed','false');
    path.addEventListener('keydown',event=>{
      if(event.key==='Enter'||event.key===' '){event.preventDefault();closeProfile();selectDistrict(layer);}
    });
  });
}}).addTo(map);
function areaLocationKey(sample){return sample.coords?'site:'+siteKey(sample):'sample:'+sample.index;}
function renderAreaSelection(){
  document.querySelectorAll('[data-area-mode]').forEach(button=>{
    const active=button.dataset.areaMode===areaMode;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
  let options,active='';
  if(areaMode==='district'){
    options=boundaryLayer.getLayers().map(layer=>[layer.feature.properties.District,layer.feature.properties.District]);
    active=selectedDistrict?.feature.properties.District||'';
  }else{
    const groups=new Map();
    for(const sample of visible){
      if(!sample.coords)continue;
      const key=areaLocationKey(sample);
      if(!groups.has(key))groups.set(key,new Set());
      groups.get(key).add(sample.location||sample.id);
    }
    options=[...groups].map(([key,names])=>[key,[...names].join(' / ')]);
    if(selectedLocation!==null){
      active='site:'+selectedLocation;
      if(!groups.has(active))options.push([active,locationName(selectedLocation)+' (no matching samples)']);
    }
  }
  options.sort((a,b)=>a[1].localeCompare(b[1],undefined,{numeric:true}));
  $('area-selection').innerHTML=`<option value="">All ${areaMode==='district'?'districts':'locations'}</option>`+options.map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
  $('area-selection').value=active;
}
document.querySelectorAll('[data-area-mode]').forEach(button=>button.onclick=()=>{
  const mode=button.dataset.areaMode;
  if(mode===areaMode)return;
  deselectArea();areaMode=mode;renderAreaSelection();
});
$('area-selection').onchange=event=>{
  const value=event.target.value;
  if(!value){deselectArea();return;}
  if(areaMode==='district'){
    closeProfile();
    const layer=boundaryLayer.getLayers().find(layer=>layer.feature.properties.District===value);
    if(layer!==selectedDistrict)selectDistrict(layer);
  }else{
    const peers=visible.filter(sample=>areaLocationKey(sample)===value);
    if(peers.length)selectLocation(siteKey(peers[0]));
  }
};
const initialBounds = boundaryLayer.getBounds();
// Offshore sampling locations remain in view even though district polygons stop at land.
samples.filter(sample=>sample.coords).forEach(sample=>initialBounds.extend(sample.coords));
function fitOverview(){map.fitBounds(initialBounds, {paddingTopLeft:[18,35],paddingBottomRight:[18,35],animate:false});}
fitOverview();
map.on('resize', fitOverview);
const points = L.layerGroup().addTo(map);
const markerCache=new Map();
function fitOpenSampleTooltips(){for(const entry of markerCache.values())fitSampleTooltip(entry);}
map.on('resize moveend',fitOpenSampleTooltips);
window.addEventListener('resize',fitOpenSampleTooltips);
window.addEventListener('scroll',fitOpenSampleTooltips,{passive:true});
window.visualViewport?.addEventListener('resize',fitOpenSampleTooltips);
window.visualViewport?.addEventListener('scroll',fitOpenSampleTooltips);
// Front-page points use exactly the same abundance scale as the explorer.
const ambientPoints=L.layerGroup().addTo(map);
let ambientSites=[];
const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
const ambientExpiry=new Set(),activeAmbientSites=new Set();
let ambientTimer=null;
function stopAmbient(){
  clearInterval(ambientTimer);ambientTimer=null;
  ambientExpiry.forEach(clearTimeout);ambientExpiry.clear();
  ambientPoints.clearLayers();activeAmbientSites.clear();
}
function addAmbientPoint(staticPoint=false){
  const available=ambientSites.filter(group=>!activeAmbientSites.has(siteKey(group[0])));
  if(!available.length)return;
  const group=available[Math.floor(Math.random()*available.length)],sample=group[0],key=siteKey(sample);
  activeAmbientSites.add(key);
  const duration=4200+Math.random()*2200;
  const size=siteScale.get(key)?.diameter??14;
  const icon=L.divIcon({className:'ambient-icon',iconSize:[size,size],iconAnchor:[size/2,size/2],html:`<span class="ambient-dot${staticPoint?' ambient-static':''}" style="background:conic-gradient(${groupColors(group)});--point-duration:${duration}ms"></span>`});
  const marker=L.marker(sample.coords,{icon,interactive:false,keyboard:false}).addTo(ambientPoints);
  marker.getElement()?.setAttribute('aria-hidden','true');
  marker.getElement()?.setAttribute('data-site-key',key);
  if(!staticPoint){
    const timeout=setTimeout(()=>{ambientPoints.removeLayer(marker);activeAmbientSites.delete(key);ambientExpiry.delete(timeout);},duration);
    ambientExpiry.add(timeout);
  }
}
function startAmbient(){
  stopAmbient();
  if(exploring||document.hidden||comparison.loading||comparison.error)return;
  // Match the explorer's location membership and biome proportions.
  const groups=new Map();
  for(const sample of samples.filter(s=>s.coords&&valueFor(s)>0)){
    const key=siteKey(sample);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(sample);
  }
  ambientSites=[...groups.values()];
  for(let i=0;i<12;i++)addAmbientPoint(motionPreference.matches);
  if(!motionPreference.matches)ambientTimer=setInterval(()=>addAmbientPoint(),450);
}
motionPreference.addEventListener('change',startAmbient);
document.addEventListener('visibilitychange',()=>document.hidden?stopAmbient():startAmbient());
function setExplorerMode(active){
  exploring=active;document.body.classList.toggle('landing',!active);
  const collapseFilters=active&&mobileLayout.matches;
  document.body.classList.toggle('filters-collapsed',collapseFilters);
  $('toggle-filters').setAttribute('aria-expanded',String(!collapseFilters));
  boundaryLayer.eachLayer(layer=>{
    layer.closeTooltip();
    layer.getElement()?.setAttribute('tabindex',active?'0':'-1');
    layer.getElement()?.setAttribute('aria-hidden',String(!active));
  });
  stopAmbient();map.closePopup();
  if(!active){points.clearLayers();markerCache.clear();}
  // Changing page mode can change the CSS viewport height without a window resize.
  map.invalidateSize({pan:false,animate:false});
}
async function enterExplorer({biome='',feature='@total',comparisonLevel='type'}={}){
  enabled=new Set(biome?[biome]:biomes);syncChecks();
  rankingSort={key:'abundance',direction:'desc'};
  // Biome selection uses the overview's already-loaded total abundance.
  // Open synchronously without a loading state or another comparison update.
  const ready=comparison.level===comparisonLevel&&comparison.feature===feature&&!comparison.loading&&!comparison.error;
  if(!ready&&comparisonCache.has(comparisonKey(comparisonLevel,feature))){
    changeComparison(comparisonLevel,feature); // Cached values apply synchronously.
  }else if(!ready){
    ['landing-biome','landing-arg','explore-all'].forEach(id=>$(id).disabled=true);
    $('landing-status').hidden=false;$('landing-status').textContent='Loading the selected resistance profile…';
    // New resistance selections still enter with their final scale, avoiding
    // a flash of total-abundance sizes while their data is being read.
    await changeComparison(comparisonLevel,feature);
  }
  if(comparison.error){
    $('landing-status').textContent=comparison.error;
    ['landing-biome','landing-arg','explore-all'].forEach(id=>$(id).disabled=false);
    return;
  }
  $('landing-status').hidden=true;
  setExplorerMode(true);update();
  // Desktop opens the full filtered aggregate; mobile keeps panels closed until requested.
  if(!mobileLayout.matches)selectAllDistricts();
  window.scrollTo({top:0,behavior:'instant'});
  $('map').focus({preventScroll:true});
}
$('landing-biome').onchange=e=>{if(e.target.value)enterExplorer({biome:e.target.value==='@all'?'':e.target.value});};
$('landing-arg').onchange=e=>{if(e.target.value)enterExplorer({feature:e.target.value,comparisonLevel:'type'});};
$('landing-filters').onsubmit=e=>{e.preventDefault();enterExplorer();};
$('return-overview').onclick=async()=>{
  selected=null;requestVersion++;closeProfile();selectDistrict(null);
  $('landing-biome').value='@all';$('landing-arg').value='@total';
  setExplorerMode(false);window.scrollTo({top:0,behavior:'instant'});
  // Restore navigation focus without opening a native mobile select picker.
  $('landing-title').focus({preventScroll:true});
  await prepareOverview();
};
$('toggle-filters').onclick=()=>{
  const collapsed=document.body.classList.toggle('filters-collapsed');
  $('toggle-filters').setAttribute('aria-expanded',String(!collapsed));
};
$('toggle-profile').onclick=()=>{
  if(!$('profile-panel').hidden){
    setProfileVisible(false);
  }else if(selected!==null||aggregateContext()){
    setProfileVisible(true);
    if(aggregateContext())renderAggregateSummary();
    renderProfile();
  }else{
    selectAllDistricts();
  }
  fitOpenSampleTooltips();
};
$('close-filters').onclick=()=>{
  document.body.classList.add('filters-collapsed');
  $('toggle-filters').setAttribute('aria-expanded','false');
  $('toggle-filters').focus({preventScroll:true});
  fitOpenSampleTooltips();
};
$('reset-filters').onclick=async()=>{
  enabled=new Set(biomes);syncChecks();
  closeProfile();areaMode='district';selectDistrict(null);
  $('comparison-search').value='';
  $('landing-biome').value='@all';$('landing-arg').value='@total';
  $('feature-search').value='';$('feature-limit').value='20';
  level='type';
  document.querySelectorAll('[data-level]').forEach(button=>{
    const active=button.dataset.level===level;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
  rankingSort={key:'abundance',direction:'desc'};rankingPage=0;
  await changeComparison('type','@total');
  renderFeatureOptions();
};
$('landing-biome').innerHTML='<option value="@all">All biomes</option>'+biomes.map(b=>`<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
async function prepareOverview(){
  ['landing-biome','landing-arg','explore-all'].forEach(id=>$(id).disabled=true);
  $('landing-status').hidden=false;$('landing-status').textContent='Reading local abundances…';
  stopAmbient();
  if(!samples.length){
    $('landing-biome').innerHTML='<option value="">No sample data</option>';
    $('landing-arg').innerHTML='<option value="">No resistance data</option>';
    $('landing-status').textContent='No sample profiles found in data/*.txt. Restore the files, then reload this page.';
    return;
  }
  try{
    await changeComparison('type','@total');
    if(comparison.error)throw new Error(comparison.error);
    const catalog=comparison.catalog;
    $('landing-arg').innerHTML='<option value="@total">All types</option>'+catalog.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name.replaceAll('_',' '))}</option>`).join('');
    ['landing-biome','landing-arg','explore-all'].forEach(id=>$(id).disabled=false);
    $('landing-status').hidden=true;startAmbient();
  }catch(error){$('landing-status').textContent='Could not read abundances. Reload the page to try again.';}
}
prepareOverview();

$('biome-filters').innerHTML = biomes.map(b => `<label class="biome-row"><input type="checkbox" data-biome="${escapeHtml(b)}" checked><span class="swatch" style="background:${colors[b]}"></span><span class="biome-name">${escapeHtml(b)}</span><span class="biome-count">${samples.filter(s=>s.biome===b).length}</span></label>`).join('');
$('biome-filters').onchange = e => {if(!e.target.matches('input'))return;e.target.checked?enabled.add(e.target.dataset.biome):enabled.delete(e.target.dataset.biome);update();};
$('select-all').onclick = () => {enabled=new Set(biomes);syncChecks();update();};
$('select-none').onclick = () => {enabled.clear();syncChecks();update();};
function syncChecks(){$('biome-filters').querySelectorAll('input').forEach(el=>el.checked=enabled.has(el.dataset.biome));}

function update(){
  if(!exploring)return;
  visible=samples.filter(s=>enabled.has(s.biome)&&valueFor(s)>0);
  if(selected!==null&&!visible.some(s=>s.index===selected)){selected=null;requestVersion++;$('profile-content').hidden=true;$('empty-profile').hidden=false;closeProfile();}
  drawPoints();
  if(selected!==null)renderSitePicker(samples[selected]);
  if(aggregateContext()&&!$('profile-panel').hidden){renderAggregateSummary();renderProfile();}
  rankingPage=0;renderRanking();
}
// Group sub-metre coordinate formatting differences without altering metadata.
function siteKey(s){return ARGComparison.locationKey(s);}
function groupColors(group){const counts={};group.forEach(s=>counts[s.biome]=(counts[s.biome]||0)+1);let start=0;return Object.entries(counts).sort().map(([b,n])=>{const end=start+n/group.length*100,segment=`${colors[b]} ${start}% ${end}%`;start=end;return segment;}).join(',');}
function fitSampleTooltip(entry){
  if(!hoverTooltips.matches){entry.marker.closeTooltip();return;}
  const tooltip=entry.marker.getTooltip();
  if(!entry.marker.isTooltipOpen())return;
  const element=tooltip.getElement(),mapBox=map.getContainer().getBoundingClientRect(),view=window.visualViewport;
  let left=Math.max(mapBox.left,view?.offsetLeft??0)+10;
  const top=Math.max(mapBox.top,view?.offsetTop??0)+10;
  let right=Math.min(mapBox.right,(view?.offsetLeft??0)+(view?.width??innerWidth))-10;
  const bottom=Math.min(mapBox.bottom,(view?.offsetTop??0)+(view?.height??innerHeight))-10;
  // Floating controls cover part of the map; keep the card clear of them too.
  const filters=$('filters-panel'),profile=$('profile-panel');
  if(filters.getClientRects().length)left=Math.max(left,filters.getBoundingClientRect().right+10);
  if(profile.getClientRects().length)right=Math.min(right,profile.getBoundingClientRect().left-10);
  if(right<=left||bottom<=top){entry.marker.closeTooltip();return;}
  element.style.width=Math.min(280,right-left)+'px';
  element.style.maxWidth=(right-left)+'px';
  element.style.maxHeight=(bottom-top)+'px';
  element.classList.remove('sample-tooltip-shifted');
  const point=entry.marker.getElement().getBoundingClientRect(),gap=8;
  const above=point.top-top-gap,below=bottom-point.bottom-gap;
  const height=element.getBoundingClientRect().height;
  const direction=height>above&&below>above?'bottom':'top';
  const offset=(point.height/2+gap)*(direction==='bottom'?1:-1);
  tooltip.options.direction=direction;tooltip.options.offset=L.point(0,offset);tooltip.update();
  const box=element.getBoundingClientRect();
  const dx=Math.max(left,Math.min(box.left,right-box.width))-box.left;
  const dy=Math.max(top,Math.min(box.top,bottom-box.height))-box.top;
  if(dx||dy){
    tooltip.options.offset=L.point(dx,offset+dy);
    element.classList.add('sample-tooltip-shifted');tooltip.update();
  }
}
function drawPoints(){
  map.closePopup();const groups=new Map();
  const filteredScale=ARGComparison.siteAbundanceScale(samples,comparison.values,enabled);
  visible.filter(s=>s.coords).forEach(s=>{const k=siteKey(s);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s);});
  for(const group of groups.values()){
    const siteMetric=filteredScale.get(siteKey(group[0]));
    const weighted=siteMetric;
    const size=siteMetric?.diameter??14;
    const locations=[...new Set(group.map(s=>s.location))];const counts={};group.forEach(s=>counts[s.biome]=(counts[s.biome]||0)+1);
    const info=Object.entries(counts).map(([b,n])=>`<span class="swatch" style="background:${colors[b]}"></span> ${escapeHtml(b)} · ${n}`).join('<br>');
    const first=group[0];
    const tooltip=`<strong>${locations.map(escapeHtml).join(' / ')}</strong><br><small class="tooltip-coordinates">${first.coords.map(n=>n.toFixed(5)).join(', ')}</small><br>${group.length} sample${group.length===1?'':'s'} at this location<br>${info}<br><strong>${escapeHtml(measureLabel())}: ${weighted.value===null?'N/A':fmt(weighted.value)+' copies / cell'}</strong>${weighted.excludedSamples?`<br><small>${weighted.usedSamples}/${weighted.totalSamples} samples have valid abundance and cell counts</small>`:''}<hr><small>${group.slice(0,3).map(s=>escapeHtml(s.id)).join('<br>')}${group.length>3?`<br>+ ${group.length-3} more samples`:''}<br>Click to view abundance profile</small>`;
    const key=siteKey(first),title=`${locations.join(' / ')}: ${group.length} samples; ${Object.keys(counts).join(', ')}`;
    let entry=markerCache.get(key);
    if(!entry){
      const icon=L.divIcon({className:'site-icon',iconSize:[size,size],iconAnchor:[size/2,size/2],html:'<div class="site-symbol"></div>'});
      const marker=L.marker(first.coords,{icon,keyboard:true,autoPanOnFocus:false,bubblingMouseEvents:false,riseOnHover:true});
      entry={marker,group,size};markerCache.set(key,entry);
      marker.bindTooltip(tooltip,{className:'sample-tooltip',direction:'top',offset:[0,-12],opacity:1}).on('tooltipopen',()=>fitSampleTooltip(entry)).on('click',()=>{
        openLocation(entry.group);
      }).addTo(points);
    }
    entry.group=group;entry.size=size;
    // Update the existing DOM node in place. setIcon()/clearLayers() would
    // destroy markers and flash them during every asynchronous refresh.
    const element=entry.marker.getElement();
    Object.assign(element.style,{width:size+'px',height:size+'px',marginLeft:-size/2+'px',marginTop:-size/2+'px'});
    element.setAttribute('aria-label',title);element.dataset.siteKey=key;
    const symbol=element.querySelector('.site-symbol');
    symbol.style.background=`conic-gradient(${groupColors(group)})`;
    symbol.classList.toggle('selected',key===selectedLocation||group.some(s=>s.index===selected));
    Object.assign(entry.marker.options.icon.options,{iconSize:[size,size],iconAnchor:[size/2,size/2]});
    entry.marker.setTooltipContent(tooltip);
    fitSampleTooltip(entry);
  }
  for(const [key,entry] of markerCache){
    if(!groups.has(key)){points.removeLayer(entry.marker);markerCache.delete(key);}
  }
  highlightDistrictPoints();

  const mapped=visible.filter(s=>s.coords).length;
  $('map-empty').hidden=mapped>0;
}
function locationName(key){
  return [...new Set(samples.filter(sample=>siteKey(sample)===key).map(sample=>sample.location||sample.id))].join(' / ');
}
function openLocation(group){
  map.closePopup();
  const key=siteKey(group[0]);
  if(key===selectedLocation)deselectArea();
  else selectLocation(key);
}
function selectAllDistricts(){
  closeProfile();selectDistrict(null);
  allDistrictProfile=true;areaMode='district';
  setProfileVisible(true);
  renderAreaSelection();renderAggregateSummary();renderProfile();
}
function selectLocation(key){
  allDistrictProfile=false;
  selected=null;selectedLocation=key;areaMode='location';
  if(selectedDistrict)selectDistrict(null);
  setProfileVisible(true);
  renderAggregateSummary();drawPoints();rankingPage=0;renderRanking();renderProfile();
}
function loadProfile(index){
  if(profileCache.has(index))return Promise.resolve(profileCache.get(index));
  if(pending.has(index))return pending.get(index);
  const sample=samples[index];
  const request=read(`data/${encodeURIComponent(sample.file)}`).then(text=>{
    const profile=ARGSource.parseSample(text,sample.file,index).profiles;
    if(pending.get(index)===request)profileCache.set(index,profile);
    return profile;
  }).finally(()=>{if(pending.get(index)===request)pending.delete(index);});
  pending.set(index,request);return request;
}
function renderSitePicker(sample){
  const peers=sample.coords?visible.filter(s=>siteKey(s)===siteKey(sample)):[sample];
  $('site-picker-label').textContent=sample.coords?`Samples at this location (${peers.length})`:'Selected sample · no coordinates';
  $('site-picker').innerHTML=(sample.coords?'<option value="@location">Location aggregate</option>':'')+peers.map(s=>`<option value="${s.index}" ${s.index===sample.index?'selected':''}>${escapeHtml(s.id)} · ${escapeHtml(s.biome)}</option>`).join('');
}
$('site-picker').onchange=e=>{
  if(e.target.value==='@location')selectLocation(selectedLocation);
  else if(e.target.value==='@district'||e.target.value==='@all')renderProfile();
  else selectSample(Number(e.target.value));
};
async function selectSample(index){
  allDistrictProfile=false;
  // Reopening a sample reads the current text file, even within the same page.
  profileCache.delete(index);pending.delete(index);
  setProfileVisible(true);
  selected=index;areaMode='location';const sample=samples[index];selectedLocation=sample.coords?siteKey(sample):null;$('empty-profile').hidden=true;$('profile-content').hidden=false;
  if(selectedDistrict)selectDistrict(null);
  $('profile-panel').classList.remove('aggregate-profile');
  $('metadata-title').textContent='Sample metadata';$('profile-total-label').textContent='Total abundance';
  $('selected-biome').textContent=sample.biome;$('selected-biome').style.setProperty('--biome-color',colors[sample.biome]);
  $('coordinate-status').textContent=sample.coords?'Geolocated':'No coordinates';
  $('selected-id').textContent=sample.id;$('selected-location').textContent=sample.location;
  $('metadata').innerHTML=Object.entries(sample.metadata).map(([k,v])=>`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v??'Not provided')}</dd>`).join('')+`<dt>Source</dt><dd>${escapeHtml(sample.file)}</dd>`;
  renderSitePicker(sample);drawPoints();
  rankingPage=0;renderRanking();
  await renderProfile();
}
document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>{level=button.dataset.level;document.querySelectorAll('[data-level]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});renderProfile();});
$('feature-search').oninput=renderProfile;$('feature-limit').onchange=renderProfile;
function aggregateContext(){
  if(selected!==null)return null;
  if(selectedDistrict)return {kind:'district',label:'District',name:selectedDistrict.feature.properties.District};
  if(selectedLocation!==null)return {kind:'location',label:'Location',name:locationName(selectedLocation)};
  if(allDistrictProfile)return {kind:'all',label:'All districts',name:'All districts'};
  return null;
}
function renderAggregateSummary(){
  const context=aggregateContext();
  if(!context)return;
  const group=rankingSamples(),locations=new Set(group.filter(sample=>sample.coords).map(siteKey)),counts={};
  group.forEach(sample=>counts[sample.biome]=(counts[sample.biome]||0)+1);
  $('profile-panel').classList.add('aggregate-profile');
  $('empty-profile').hidden=true;$('profile-content').hidden=false;
  $('selected-biome').textContent=context.label;$('coordinate-status').textContent='Abundance';
  $('selected-id').textContent=context.name;
  $('selected-location').textContent=`${group.length.toLocaleString()} samples · ${locations.size} ${locations.size===1?'location':'locations'}`;
  $('site-picker-label').textContent=context.kind==='all'?'Samples across all districts':`Samples ${context.kind==='district'?'in this district':'at this location'}`;
  $('site-picker').innerHTML=`<option value="@${context.kind}">${context.label} aggregate</option>`+group.map(sample=>`<option value="${sample.index}">${escapeHtml(sample.id)} · ${escapeHtml(sample.biome)}</option>`).join('');
  $('metadata-title').textContent=context.label+' metadata';$('profile-total-label').textContent='Abundance';
  const coords=context.kind==='location'?samples.find(sample=>siteKey(sample)===selectedLocation)?.coords:null;
  $('metadata').innerHTML=`<dt>Samples</dt><dd>${group.length}</dd><dt>Locations</dt><dd>${locations.size}</dd><dt>Biomes</dt><dd>${Object.entries(counts).map(([biome,count])=>escapeHtml(biome)+' · '+count).join('<br>')}</dd>`+(coords?`<dt>Latitude</dt><dd>${coords[0].toFixed(5)}</dd><dt>Longitude</dt><dd>${coords[1].toFixed(5)}</dd>`:'');
}
function loadAggregateProfile(group,profileLevel){
  const files=group.map(sample=>sample.file).sort(),key=JSON.stringify([profileLevel,files]);
  if(!aggregateProfileCache.has(key)){
    const request=(window.ARGStatic?ARGStatic.aggregate(group,profileLevel):fetch('/api/aggregate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files,level:profileLevel})})
      .then(response=>{if(!response.ok)throw new Error('Could not read the aggregate profile.');return response.json();}))
      .catch(error=>{aggregateProfileCache.delete(key);throw error;});
    aggregateProfileCache.set(key,request);
  }
  return aggregateProfileCache.get(key);
}
async function renderProfile(){
  const aggregate=aggregateContext();
  if(selected===null&&!aggregate)return;
  const version=++requestVersion,sample=selected===null?null:samples[selected],profileLevel=level;
  const group=aggregate?rankingSamples():null;
  $('profile-total').textContent='…';$('feature-label').textContent=`Detected ${profileLevel==='type'?'types':profileLevel==='subtype'?'subtypes':'genes'}`;
  $('profile-features').textContent='…';$('chart-caption').textContent='';$('chart').replaceChildren();$('download-profile').disabled=true;
  try{
    const profile=aggregate?await loadAggregateProfile(group,profileLevel):await loadProfile(sample.index);
    if(version!==requestVersion)return;
    const all=aggregate?profile.features:profile[profileLevel];
    const total=aggregate?profile.total:ARGSource.total(all);
    $('profile-total').textContent=total===null?'—':fmt(total);
    const nonzero=all.filter(([,value])=>value>0);$('profile-features').textContent=nonzero.length.toLocaleString();
    const query=$('feature-search').value.trim().toLowerCase();const filtered=all.filter(([id])=>id.toLowerCase().includes(query));
    const limit=$('feature-limit').value,shown=limit==='all'?filtered:filtered.slice(0,Number(limit)),max=all[0]?.[1]||1;
    const coverage=aggregate?` Abundance across ${profile.usedSamples} of ${profile.totalSamples} matching samples.`:'';
    $('chart-caption').textContent=`Showing ${shown.length} of ${filtered.length} ${query?'matching ':''}features.${coverage}`;
    $('chart').innerHTML=shown.map(([id,value])=>`<div class="bar-row" title="${escapeHtml(id)}: ${value} copies/cell"><div class="bar-label"><span class="bar-name">${escapeHtml(id)}</span><span class="bar-value">${fmt(value)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${value/max*100}%;background:${aggregate?'#727272':colors[sample.biome]}"></div></div></div>`).join('')||'<p class="muted fine">No features match this selection.</p>';
    $('download-profile').disabled=!all.length;
  }catch(error){if(version===requestVersion){$('chart-caption').textContent=error.message;$('profile-features').textContent='—';$('profile-total').textContent='—';}}
}
$('download-profile').onclick=async()=>{
  const aggregate=aggregateContext();
  if(selected===null&&!aggregate)return;
  const exportLevel=level,sample=selected===null?null:samples[selected];
  const name=aggregate?aggregate.name:sample.id;
  const profile=aggregate?await loadAggregateProfile(rankingSamples(),exportLevel):await loadProfile(sample.index);
  const csvCell=value=>'"'+String(value).replace(/"/g,'""')+'"';
  const rows=aggregate?
    [[aggregate.kind,'level','feature','abundance_copies_per_cell','total_cells','used_samples'],...profile.features.map(([id,value])=>[name,exportLevel,id,value,profile.totalCells,profile.usedSamples])]:
    [['sample','biome','level','feature','abundance_copies_per_cell'],...profile[exportLevel].map(([id,value])=>[sample.id,sample.biome,exportLevel,id,value])];
  const url=URL.createObjectURL(new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`${name}_${exportLevel}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

update();

$('comparison-search').disabled=false;
document.querySelectorAll('[data-comparison-level]').forEach(button=>button.disabled=false);
}

initializeAtlas().catch(error=>{
  document.getElementById('landing-status').textContent=error.message;
  const notice=document.getElementById('map-empty');notice.hidden=false;notice.textContent=error.message;
});
