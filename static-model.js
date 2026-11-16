/* Static sparse abundance tables; shared by the browser worker and parity tests. */
(function(root){
  'use strict';
  function sum(values){let total=0,error=0;for(const value of values){const adjusted=value-error,next=total+adjusted;error=(next-total)-adjusted;total=next;}return total;}
  function parseLevel(text){
    const files=[],statuses=[],totals=[],features=new Map();let section='';
    for(const line of text.split('\n')){
      if(line==='[samples]'||line==='[features]'){section=line;continue;}
      if(!line)continue;
      const cells=line.split('\t');
      if(section==='[samples]'){
        files.push(decodeURIComponent(cells[0]));statuses.push(cells[1]);totals.push(cells[1]==='ok'?Number(cells[2]):null);
      }else if(section==='[features]'){
        const values=new Map();
        for(const cell of cells.slice(1)){const colon=cell.indexOf(':');values.set(Number(cell.slice(0,colon)),Number(cell.slice(colon+1)));}
        features.set(decodeURIComponent(cells[0]),values);
      }
    }
    return {files,statuses,totals,features};
  }
  function comparison(table,feature){
    const values=table.features.get(feature);
    return 'file\tabundance\tstatus\n'+table.files.map((file,i)=>{
      const status=table.statuses[i],value=status==='ok'?(feature==='@total'?table.totals[i]:(values?.get(i)??0)):'';
      return `${encodeURIComponent(file)}\t${value}\t${status}`;
    }).join('\n');
  }
  function aggregate(table,samples){
    const requested=new Map(samples.map(sample=>[sample.file,sample.cells]));
    const weights=new Map();
    table.files.forEach((file,i)=>{
      const cells=Number(requested.get(file));
      if(table.statuses[i]==='ok'&&Number.isFinite(cells)&&cells>0&&Number.isFinite(cells*table.totals[i]))weights.set(i,cells);
    });
    const totalCells=sum(weights.values()),features=[];
    if(totalCells){
      for(const [name,values] of table.features){
        const copies=[];
        for(const [i,value] of values)if(weights.has(i))copies.push(value*weights.get(i));
        if(copies.length)features.push([name,sum(copies)/totalCells]);
      }
      features.sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0));
    }
    return {features,total:weights.size?sum(features.map(([,value])=>value)):null,totalCells,
      usedSamples:weights.size,totalSamples:requested.size,excludedSamples:requested.size-weights.size};
  }
  root.ARGStaticModel={parseLevel,comparison,aggregate};
  if(typeof module!=='undefined')module.exports=root.ARGStaticModel;
})(typeof self!=='undefined'?self:globalThis);
