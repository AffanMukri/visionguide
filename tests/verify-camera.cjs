const vm = require('vm');
const fs = require('fs');
const assert = require('assert/strict');
const listeners = {}, nodes = {}, spoken = [], stored = {};
let mediaCalls = [], responder, stopped = 0;
function element() { return { innerHTML:'', textContent:'', style:{}, dataset:{}, classList:{toggle(){}}, focus(){}, addEventListener(){}, showModal(){this.open=true}, close(){this.open=false}, play(){return Promise.resolve()} }; }
const document = { hidden:false, activeElement:null, body:{className:''}, documentElement:{style:{}}, querySelector:s=>nodes[s]??=element(), getElementById:id=>nodes['#'+id]??=element(), querySelectorAll:()=>[], addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn)} };
const window = { isSecureContext:true, scrollTo(){}, addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn)}, speechSynthesis:{cancel(){},speak(u){spoken.push(u);u.onstart?.()}} };
const context = {console,document,window,navigator:{mediaDevices:{getUserMedia:async constraints=>{mediaCalls.push(constraints);return responder()}}},localStorage:{getItem:k=>stored[k]||null,setItem:(k,v)=>stored[k]=v},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1280,requestAnimationFrame:f=>f(),setTimeout:()=>42,clearTimeout(){},setInterval:()=>43,clearInterval(){},SpeechSynthesisUtterance:function(text){this.text=text},FormData};
vm.createContext(context);
vm.runInContext(fs.readFileSync('dist/camera.js','utf8'),context);
vm.runInContext(fs.readFileSync('dist/app.js','utf8'),context);
function run(code) {return vm.runInContext(code,context)}
function click(action,id){listeners.click.forEach(fn=>fn({preventDefault(){},stopImmediatePropagation(){},target:{closest:()=>({dataset:{action,id}})}}))}
function trackStream(){const events={};const track={stop(){stopped++},addEventListener:(n,fn)=>events[n]=fn};return {stream:{getTracks:()=>[track],getVideoTracks:()=>[track]},events}}
function html(){return nodes['#app'].innerHTML}

(async()=>{
  assert(html().includes('Start your journey'));
  assert(html().includes('Sign in'));
  assert.equal(mediaCalls.length,0,'no access on launch');
  run('authenticated=true;page="welcome";render()'); assert(html().includes('Get Started'));
  click('setup'); assert(html().includes('Listen first'));
  click('permissions'); assert(html().includes('Camera preview'));
  click('complete-onboarding'); assert(html().includes('Start camera guide'));
  click('camera'); assert.equal(mediaCalls.length,0,'opening guide does not prompt');
  click('camera-demo'); assert(html().includes('Move slightly left')); assert.equal(mediaCalls.length,0);
  for(let i=0;i<6;i++){click('camera-scene',i); assert(spoken.at(-1).text.startsWith('Demo instruction.')); assert(html().includes(run('cameraScenes['+i+'].action')))}
  click('focus-view'); assert(run('focusView')); assert(html().includes('inert'));
  click('camera-voice');assert.equal(run('settings.voice'),false);
  click('camera-voice');assert.equal(run('settings.voice'),true);
  let live=trackStream();responder=()=>live.stream;await run('requestCamera()');
  assert.equal(run('cameraState'),'live');assert.equal(nodes['#camera-video'].srcObject,live.stream);
  assert.equal(mediaCalls[0].audio,false,'microphone is never requested');
  assert.equal(mediaCalls[0].video.facingMode.ideal,'environment');
  click('home'); assert.equal(stopped,1,'leaving releases camera');assert.equal(run('cameraStream'),null);
  click('camera');responder=()=>Promise.reject({name:'NotAllowedError'});await run('requestCamera()');
  assert.equal(run('cameraState'),'error');assert(html().includes('not allowed'));assert(html().includes('Try without camera'));
  click('camera-demo');assert.equal(run('cameraDemo'),true);assert(html().includes('Demo instruction'));
  let resolveLate;responder=()=>new Promise(r=>resolveLate=r);const pending=run('requestCamera()');click('home');live=trackStream();resolveLate(live.stream);await pending;assert.equal(stopped,2,'late permission response is released');assert.equal(run('cameraStream'),null);
  click('camera');live=trackStream();responder=()=>live.stream;await run('requestCamera()');
  document.hidden=true;listeners.visibilitychange.forEach(fn=>fn());assert.equal(stopped,3);assert.equal(run('cameraState'),'error');document.hidden=false;
  live=trackStream();responder=()=>live.stream;await run('requestCamera()');live.events.ended();assert.equal(run('cameraStream'),null);assert.equal(run('cameraState'),'error');
  run('settings.screen=true');click('camera-demo');assert(nodes['#guidance-announcement'].textContent.includes('Demo instruction'));run('settings.screen=false');
  for(const p of ['navigate','environment','read','sos','settings','accessibility','activity','places','contacts','privacy','practice']){click(p);assert(html().length>1000,p)}
  run('destination=places[2]');click('begin');for(let i=0;i<8;i++)click('next');assert(html().includes('You’ve arrived'));click('finish');assert.equal(run('journeys[0].status'),'Completed');
  click('read');click('read-text');assert(html().includes('Room 204'));
  click('sos');click('confirm-sos');assert(nodes['#modal'].open);click('activate-sos');assert(html().includes('Emergency Alert Active'));click('cancel-sos');
  click('practice');click('start-practice');click('practice-cue',4);assert(html().includes('Obstacle directly ahead'));
  click('listen-preset');assert.equal(run('settings.size'),'Large');assert.equal(run('settings.speed'),'0.8');assert.equal(run('focusView'),true);
  click('contrast-preset');assert(document.body.className.includes('contrast'));
  run('settings.appearance="Dark";settings.contrast=false;render()');assert(document.body.className.includes('dark'));
  const htmlSource=fs.readFileSync('dist/index.html','utf8');for(const asset of ['style.css','experience.css','visionConfig.js','sceneState.js','guidanceManager.js','camera.js','tracker.js','freeSpaceAnalyzer.js','riskEngine.js','objectDetection.js','depthEstimation.js','ocrReader.js','authService.js','app.js','voiceCommands.js'])assert(htmlSource.includes(asset)&&fs.existsSync('dist/'+asset));
  assert(htmlSource.includes('tesseract.min.js'));
  console.log('PASS: opt-in camera permission, live preview binding, camera audio disabled, all six spoken scenes, focus view, voice toggle, denial fallback, lifecycle cleanup, screen reader cues, accessibility presets, and existing core flows.');
})().catch(e=>{console.error(e);process.exitCode=1});
