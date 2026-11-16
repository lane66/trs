/* Load and calculate away from the UI thread. All URLs are relative for project Pages. */
'use strict';
importScripts('static-model.js');
const levels=new Map();
async function readText(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Could not load ${url} (HTTP ${response.status}). Reload the page to retry.`);
  return response;
}
async function loadLevel(level,asset){
  if(!['gene','subtype','type'].includes(level))throw new Error('Invalid profile level');
  if(!levels.has(level)){
    const request=(async()=>{
      const compressed=typeof DecompressionStream==='function';
      const response=await readText('static-index/'+asset+(compressed?'.gz':''));
      const text=compressed?await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text():await response.text();
      return ARGStaticModel.parseLevel(text);
    })().catch(error=>{levels.delete(level);throw error;});
    levels.set(level,request);
  }
  return levels.get(level);
}
self.onmessage=async({data})=>{
  try{
    const table=await loadLevel(data.level,data.asset);
    let result;
    if(data.kind==='features')result=[...table.features.keys()].map(encodeURIComponent).join('\n');
    else if(data.kind==='comparison')result=ARGStaticModel.comparison(table,data.feature);
    else if(data.kind==='aggregate')result=ARGStaticModel.aggregate(table,data.samples);
    else throw new Error('Unknown static query');
    self.postMessage({id:data.id,result});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
