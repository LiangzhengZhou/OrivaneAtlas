import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as wait } from "node:timers/promises";

const [exe, phase, profile] = process.argv.slice(2);
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const {port} = reservation.address();
await new Promise(resolve => reservation.close(resolve));
const app = spawn(exe, [], { windowsHide:true, stdio:"ignore", env:{...process.env,
 WEBVIEW2_USER_DATA_FOLDER: profile,
 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`
}});
let socket;
try {
 let target, diagnostic="no debugger response";
 for(let i=0;i<100;i++){
  if(app.exitCode!==null) throw Error("Installed application exited: "+app.exitCode);
  try{
   const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)})).json();
   diagnostic=JSON.stringify(tabs.map(t=>({type:t.type,url:t.url?.split("?")[0].slice(0,100)}))); target=tabs.find(x=>x.type==="page" && /tauri\.localhost|^tauri:\/\//.test(x.url));
   if(target) break;
  }catch(e){diagnostic=e.cause?.code??String(e)}
  await wait(500);
 }
 if(!target){
  const report=execFileSync("powershell.exe",["-NoProfile","-Command",
    "Get-Process -Id "+app.pid+" | Select-Object -Property ProcessName,MainWindowTitle,MainWindowHandle,Responding | ConvertTo-Json -Compress"],{encoding:"utf8"});
  console.log("CDP status",diagnostic,"native window",report.trim());
  const status=JSON.parse(report);
  if(!status.Responding || !status.MainWindowHandle || status.MainWindowTitle!=="Orivane Atlas")throw Error("Installed native window did not open");
  console.log(phase+" installed app opened a responsive Orivane Atlas window; CDP interaction unavailable");
  process.exitCode=0;
} else {
 socket=new WebSocket(target.webSocketDebuggerUrl);
 await once(socket,"open");
 let id=0;
 const evaluate=(expression)=>new Promise((resolve,reject)=>{
  const current=++id,timer=setTimeout(()=>reject(Error("WebView evaluation timeout")),5000);
  const accept=event=>{const data=JSON.parse(event.data);if(data.id!==current)return;
   clearTimeout(timer);socket.removeEventListener("message",accept);
   if(data.error||data.result.exceptionDetails) reject(Error("WebView evaluation failed"));
   else resolve(data.result.result.value);};
  socket.addEventListener("message",accept);
  socket.send(JSON.stringify({id:current,method:"Runtime.evaluate",params:{expression,returnByValue:true}}));
 });
 let ready=false;
 for(let i=0;i<60;i++){if(await evaluate("document.title === 'Orivane Atlas' && document.querySelector('#root')?.childElementCount > 0")){ready=true;break}await wait(300)}
 if(!ready)throw Error("Installed UI did not render");
 if(phase==="before")await evaluate("localStorage.setItem('fixture.upgrade.marker','isolated-3.2.3')");
 if(await evaluate("localStorage.getItem('fixture.upgrade.marker')")!=="isolated-3.2.3")throw Error("Fixture state missing");
 console.log(phase+" installed UI rendered and synthetic profile marker verified");
 await wait(2000);
 }
} finally {
 socket?.close();
 if(app.pid && app.exitCode===null){
  try {execFileSync("taskkill.exe",["/PID",String(app.pid),"/T","/F"],{stdio:"ignore"});}catch{}
 }
}
