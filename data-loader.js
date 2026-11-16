/* Parses original sectioned text files in memory. No generated dataset is used. */
(function(root){
  'use strict';
  const levels=['gene','subtype','type'];
  const missing=value=>value==null||['','nan','na','none'].includes(String(value).trim().toLowerCase());
  function coordinates(metadata){
    if(missing(metadata.lat)||missing(metadata.long))return null;
    const lat=Number(metadata.lat),lon=Number(metadata.long);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lat,lon]:null;
  }
  function parseSample(text,file,index=0){
    const metadata=Object.create(null),values=Object.fromEntries(levels.map(k=>[k,new Map()]));
    let section=null;
    for(const [offset,raw] of text.replace(/^\uFEFF/,'').split(/\r?\n/).entries()){
      const line=raw.trim();if(!line)continue;
      if(line.startsWith('[')&&line.endsWith(']')){section=line.slice(1,-1).toLowerCase();continue;}
      const tab=raw.indexOf('\t'),key=(tab<0?raw:raw.slice(0,tab)).trim(),value=tab<0?'':raw.slice(tab+1).trim();
      if(section==='metadata'){metadata[key]=missing(value)?null:value;continue;}
      if(!levels.includes(section)||tab<0||!key||value==='')throw new Error(`${file}:${offset+1}: invalid ${section||'unsectioned'} row`);
      const abundance=Number(value);
      if(!Number.isFinite(abundance)||abundance<0)throw new Error(`${file}:${offset+1}: abundance must be a finite, non-negative number`);
      const sum=(values[section].get(key)||0)+abundance;
      if(!Number.isFinite(sum))throw new Error(`${file}:${offset+1}: abundance total is too large`);
      values[section].set(key,sum);
    }
    const profiles=Object.fromEntries(levels.map(k=>[k,[...values[k]].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))]));
    const sample={index,file,id:metadata.Sample||file.replace(/\.txt$/i,''),biome:metadata.biome||'Unknown',location:metadata.GPS_Name||metadata.Sample||file.replace(/\.txt$/i,''),coords:coordinates(metadata),metadata};
    return {sample,profiles};
  }
  function parseMetadata(text){
    const samples=[];let filename=null,lines=[];
    function finish(){if(filename!==null)samples.push(parseSample(lines.join('\n'),filename,samples.length).sample);}
    for(const line of text.split(/\r?\n/)){
      if(line.startsWith('[source]\t')){finish();filename=decodeURIComponent(line.slice(9));lines=[];}
      else lines.push(line);
    }
    finish();return samples;
  }
  // Compensated sum keeps the displayed total stable for long feature tables.
  function total(pairs){let sum=0,correction=0;for(const [,value] of pairs){const next=value-correction,t=sum+next;correction=(t-sum)-next;sum=t;}return sum;}
  root.ARGSource={parseSample,parseMetadata,total};
  if(typeof module!=='undefined')module.exports=root.ARGSource;
})(typeof window!=='undefined'?window:globalThis);
