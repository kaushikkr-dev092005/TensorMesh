import { createServer } from 'node:http';
import express from 'express';
import { ExpressPeerServer } from 'peer';
import { pathToFileURL } from 'node:url';
// A TensorMesh-owned discovery namespace. WebRTC data never passes through this server.
export async function startSignal({host='127.0.0.1',port=9000}={}) {
  const app=express();
  const server=createServer(app);
  const discovery=ExpressPeerServer(server,{path:'/',key:'tensormesh',allow_discovery:false,alive_timeout:30000,expire_timeout:5000});
  app.get('/health',(_req,res)=>res.json({service:'TensorMesh signaling'}));
  app.use('/tensormesh',discovery);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  return {server,discovery,port:server.address().port};
}
if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  const running=await startSignal({host:process.env.TENSORMESH_SIGNAL_BIND||'127.0.0.1',port:Number(process.env.TENSORMESH_SIGNAL_PORT||9000)});
  console.log(`TensorMesh signaling: port ${running.port}, /tensormesh, key tensormesh`);
}
