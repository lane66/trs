/* Pure helpers shared by the interactive ranking and its tests. */
(function(root){
  'use strict';
  const normalize=text=>String(text).toLowerCase().replace(/[β]/g,'beta').replace(/[_\s-]+/g,'');
  function parseValues(text){
    const rows=new Map();
    for(const line of text.trim().split(/\r?\n/).slice(1)){
      const [file,raw,status]=line.split('\t');
      if(!file)continue;
      const value=status==='ok'&&raw!==''?Number(raw):null;
      rows.set(decodeURIComponent(file),{value:Number.isFinite(value)?value:null,status});
    }
    return rows;
  }
  function ranked(samples,values){
    const rows=samples.map(sample=>({sample,...(values.get(sample.file)||{value:null,status:'unavailable'})}));
    rows.sort((a,b)=>(a.value===null)-(b.value===null)||(b.value??0)-(a.value??0)||a.sample.id.localeCompare(b.sample.id)||a.sample.file.localeCompare(b.sample.file));
    let previous,rank=0;
    rows.forEach((row,i)=>{if(row.value===null){row.rank=null;return;}if(i===0||row.value!==previous)rank=i+1;row.rank=rank;previous=row.value;});
    return rows;
  }
  function parseTypeMatrix(text){
    const [header,...lines]=text.trimEnd().split(/\r?\n/);
    const features=header.split('\t').slice(2).map(decodeURIComponent);
    const comparisons=new Map(features.map(feature=>[feature,new Map()]));
    for(const line of lines){
      if(!line)continue;
      const [file,status,...cells]=line.split('\t');
      features.forEach((feature,i)=>{
        const raw=cells[i],value=status==='ok'&&raw!==undefined&&raw!==''?Number(raw):null;
        comparisons.get(feature).set(decodeURIComponent(file),{value:Number.isFinite(value)?value:null,status});
      });
    }
    return comparisons;
  }
  const locationKey=sample=>sample.coords?.map(n=>n.toFixed(5)).join(',');
  function sum(values){
    let total=0,correction=0;
    for(const value of values){const adjusted=value-correction,next=total+adjusted;correction=(next-total)-adjusted;total=next;}
    return total;
  }
  function weightedAbundance(samples,values){
    const copies=[],cells=[];
    for(const sample of samples){
      const abundance=values.get(sample.file)?.value;
      const totalCells=Number(sample.metadata?.nCell);
      if(typeof abundance!=='number'||!Number.isFinite(abundance)||abundance<0||!Number.isFinite(totalCells)||totalCells<=0)continue;
      const totalCopies=abundance*totalCells;
      if(!Number.isFinite(totalCopies))continue;
      copies.push(totalCopies);cells.push(totalCells);
    }
    const totalCopies=sum(copies),totalCells=sum(cells);
    const value=totalCells>0&&Number.isFinite(totalCopies)&&Number.isFinite(totalCells)?totalCopies/totalCells:null;
    return {value,totalCopies,totalCells,usedSamples:cells.length,excludedSamples:samples.length-cells.length,totalSamples:samples.length};
  }
  // Keep a fixed reference across biome selections, including single-biome maxima.
  function siteAbundanceScale(allSamples,values,selectedBiomes=null){
    const groups=new Map();
    for(const sample of allSamples){
      if(!sample.coords)continue;
      const key=locationKey(sample);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(sample);
    }
    let maximum=0;
    const sites=new Map();
    for(const [key,group] of groups){
      const biomeGroups=new Map();
      for(const sample of group){
        if(!biomeGroups.has(sample.biome))biomeGroups.set(sample.biome,[]);
        biomeGroups.get(sample.biome).push(sample);
      }
      for(const peers of biomeGroups.values())maximum=Math.max(maximum,weightedAbundance(peers,values).value??0);
      const matching=selectedBiomes?group.filter(sample=>selectedBiomes.has(sample.biome)):group;
      if(matching.length)sites.set(key,weightedAbundance(matching,values));
    }
    return new Map([...sites].map(([key,site])=>[key,{...site,diameter:14+(maximum&&site.value?12*Math.sqrt(Math.min(1,site.value/maximum)):0)}]));
  }

  function pointInGeometry(coords,geometry){
    if(!coords||!geometry)return false;
    const [y,x]=coords,tolerance=1e-10;
    function ringPosition(ring){
      let inside=false;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const [ax,ay]=ring[j],[bx,by]=ring[i],dx=bx-ax,dy=by-ay;
        if(Math.abs((x-ax)*dy-(y-ay)*dx)<=tolerance*Math.hypot(dx,dy)&&
          x>=Math.min(ax,bx)-tolerance&&x<=Math.max(ax,bx)+tolerance&&
          y>=Math.min(ay,by)-tolerance&&y<=Math.max(ay,by)+tolerance)return 2;
        if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
      }
      return inside?1:0;
    }
    function contains(polygon){
      if(!polygon.length)return false;
      const outer=ringPosition(polygon[0]);
      if(outer!==1)return outer===2;
      for(const hole of polygon.slice(1)){
        const position=ringPosition(hole);
        if(position===2)return true;
        if(position===1)return false;
      }
      return true;
    }
    if(geometry.type==='Polygon')return contains(geometry.coordinates);
    if(geometry.type==='MultiPolygon')return geometry.coordinates.some(contains);
    return false;
  }
  root.ARGComparison={normalize,parseValues,parseTypeMatrix,ranked,locationKey,weightedAbundance,siteAbundanceScale,pointInGeometry};
  if(typeof module!=='undefined')module.exports=root.ARGComparison;
})(typeof window!=='undefined'?window:globalThis);
