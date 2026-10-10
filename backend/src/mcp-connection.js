const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function waitForBackend(base,{fetchImpl=fetch,timeoutMs=120000,intervalMs=500,requestTimeoutMs=1500,startBackend=async()=>{}}={}){
  try{const r=await fetchImpl(base+'/',{signal:AbortSignal.timeout(requestTimeoutMs)});if(r.ok)return;}catch{}
  await startBackend();
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    await pause(Math.min(intervalMs,Math.max(0,deadline-Date.now())));
    try{const r=await fetchImpl(base+'/',{signal:AbortSignal.timeout(requestTimeoutMs)});if(r.ok)return;}catch{}
  }
  throw new Error(`Lettide service did not become ready within ${Math.ceil(timeoutMs/1000)} seconds`);
}

export async function requestWithReconnect(url,options,{fetchImpl=fetch,reconnect=async()=>{},maxAttempts=2}={}){
  const method=String((typeof options==='function'?options():options)?.method||'GET').toUpperCase();
  for(let attempt=0;attempt<maxAttempts;attempt++){
    try{
      const response=await fetchImpl(url,typeof options==='function'?options():options);
      if(![502,503,504].includes(response.status))return response;
    }catch{}
    if(!['GET','HEAD'].includes(method)){
      await reconnect();
      throw new Error('Backend connection was interrupted during a write; outcome may be uncertain. The request was not replayed.');
    }
    if(attempt===maxAttempts-1)break;
    await reconnect();
  }
  throw new Error('Lettide service is unavailable after reconnecting');
}
