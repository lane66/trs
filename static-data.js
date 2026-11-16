/* Included only in the GitHub Pages build. The local Python mode remains optional. */
(function(root){
  'use strict';
  let manifest,worker,sequence=0;
  const pending=new Map();
  async function read(url,format='text'){
    const response=await fetch(url,{cache:'no-cache'});
    if(!response.ok)throw new Error(`Could not load the static index (HTTP ${response.status}). Reload the page to retry.`);
    return format==='json'?response.json():response.text();
  }
  function getManifest(){
    if(!manifest)manifest=read('static-index/manifest.json','json').catch(error=>{manifest=null;throw error;});
    return manifest;
  }
  async function query(kind,level,extra={}){
    const index=await getManifest();
    if(!worker){
      worker=new Worker('static-worker.js');
      worker.onmessage=({data})=>{
        const request=pending.get(data.id);if(!request)return;
        pending.delete(data.id);data.error?request.reject(new Error(data.error)):request.resolve(data.result);
      };
      worker.onerror=()=>{
        for(const request of pending.values())request.reject(new Error('Could not load the profile worker. Reload the page to retry.'));
        pending.clear();worker.terminate();worker=null;
      };
    }
    return new Promise((resolve,reject)=>{
      const id=++sequence;pending.set(id,{resolve,reject});
      worker.postMessage({id,kind,level,asset:index.levels[level],...extra});
    });
  }
  root.ARGStatic={
    async read(url){
      const [path,search='']=url.split('?'),index=await getManifest();
      if(path==='/api/metadata')return read('static-index/'+index.metadata);
      if(path==='/api/type-matrix')return read('static-index/'+index.typeMatrix);
      const params=new URLSearchParams(search),level=params.get('level')||'type';
      if(path==='/api/features')return query('features',level);
      if(path==='/api/comparison')return query('comparison',level,{feature:params.get('feature')||'@total'});
      throw new Error('Unknown static data request');
    },
    aggregate(samples,level){return query('aggregate',level,{samples:samples.map(sample=>({file:sample.file,cells:sample.metadata.nCell}))});}
  };
})(window);
