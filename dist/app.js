const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={compass:'m12 3 8 18-8-5-8 5 8-18Z',home:'m3 10 9-7 9 7v11h-6v-7H9v7H3Z',navigate:'m4 20 5-11 11-5-5 11-11 5Z m5-11 6 6',environment:'M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 12h8 M12 8v8',read:'M4 4h16v16H4Z M8 9h8 M12 9v7 M9 16h6',activity:'M3 12a9 9 0 1 0 3-6 M3 3v6h6 M12 7v5l3 2',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',sos:'M12 3 2 21h20L12 3Z M12 9v5 M12 17v1',pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6',arrow:'M4 12h16 M14 6l6 6-6 6',left:'M18 20v-8H5 M10 6l-6 6 6 6',right:'M6 20v-8h13 M14 6l6 6-6 6',straight:'M12 21V3 M5 10l7-7 7 7',check:'m5 12 4 4L19 6',voice:'M4 10v4h4l5 4V6l-5 4H4Z M17 8a7 7 0 0 1 0 8 M20 5a11 11 0 0 1 0 14',device:'M3 8h7v7H3Z M14 8h7v7h-7Z M10 10h4 M3 8 1 5 M21 8l2-3',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z m-4 10 3 3 5-6',book:'M12 5c-4-3-9-2-9-2v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z M12 5v16',train:'M6 3h12v14H6Z M6 10h12 M9 6h6 M8 20l2-3 M16 20l-2-3 M9 14h.1 M15 14h.1',plus:'M12 5v14 M5 12h14',close:'m6 6 12 12 M18 6 6 18',stairs:'M3 20h5v-5h5v-5h5V5h3',person:'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M12 9v6 M7 12h10 M8 22l4-7 4 7',car:'m4 9 2-5h12l2 5 M3 9h18v9H3Z M6 18v3 M18 18v3 M6 13h2 M16 13h2',pause:'M8 4v16 M16 4v16',sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2',back:'M20 12H4 M10 6l-6 6 6 6'};
Object.assign(paths,{camera:'M3 7h4l2-3h6l2 3h4v14H3Z M12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8',focus:'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',play:'m8 4 12 8-12 8V4Z',muted:'M3 9v6h4l5 4V5L7 9H3Z M16 9l6 6 M22 9l-6 6',mail:'M3 6h18v12H3Z m1 1 8 6 8-6',logout:'M10 17l5-5-5-5 M15 12H3 M19 4h2v16h-2'});
const icon=n=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[n]||paths.compass}"/></svg>`;
const btn=(text,action,cls='',extra='')=>`<button class="${cls}" data-action="${action}" ${extra}>${text}</button>`;
const defaults={voice:true,contrast:false,reduce:false,screen:false,size:'Standard',appearance:'Light',intensity:'Medium',detail:'Standard',distance:'Near · 1.5 m',auto:false,speed:'1',volume:'1',location:true,history:true,notifications:true,confirm:true};
let saved={};try{saved=JSON.parse(localStorage.getItem('visionguide')||'{}')}catch{}
const isFictionalContact=c=>c?.name==='Asha Sharma'&&String(c?.phone||'').replace(/\s/g,'')==='+919000000000';
let settings={...defaults,...saved.settings},places=saved.places||[{id:1,name:'Home',address:'Bandra West, Mumbai',home:true},{id:2,name:'College',address:'Linking Road, Bandra'},{id:3,name:'Railway Station',address:'Bandra Railway Station'},{id:4,name:'Hospital',address:'Hill Road, Bandra'}],contacts=(Array.isArray(saved.contacts)?saved.contacts:[]).filter(c=>!isFictionalContact(c)),journeys=saved.journeys||[{name:'College',time:'Today · 9:15 AM',distance:'2.4 km',duration:'28 min',status:'Completed'},{name:'Railway Station',time:'Yesterday · 5:30 PM',distance:'1.8 km',duration:'21 min',status:'Completed'}];
let authReady=!window.supabaseAuth,authenticated=false,passwordRecovery=false,authBusy=false,authMessage='',authError='',page=authReady?'landing':'auth-loading',onboarded=!!saved.onboarded,destination=null,step=0,paused=true,active=false,mapVisible=true,device='Connected',readIndex=-1,practice=false,practiceIndex=0,sosActive=false,sosPhase='idle',sosDetail='',sosLocation=null,sosPreparedContact=null,sosMessageId='',sosFallback=null,search='',timer=null,toastTimer=null,lastFocus=null,lastSpokenText='',speechResolver=null,speechWatchdog=null;
const sequence=[['Navigation started','Your journey is ready','straight','650 m','8 min'],['Continue straight','Continue for 40 m','straight','610 m','7 min'],['Slow down','Pole ahead · 1.5 m','sos','560 m','7 min','warning'],['Move slightly left','Obstacle ahead · 0.8 m','left','540 m','6 min'],['Path clear','Continue for 40 m','check','450 m','5 min'],['Stairs ahead','Slow down · Use the handrail','stairs','350 m','4 min','warning'],['Turn right','Turn right in 20 m','right','250 m','3 min'],['Continue straight','Your destination is ahead','straight','100 m','1 min'],["You’ve arrived",'Destination reached successfully','check','0 m','0 min']];
const practiceCommands=[['Continue straight','Follow the path ahead','straight'],['Move left','Move slightly to your left','left'],['Move right','Move slightly to your right','right'],['Slow down','Take your time','sos'],['Stop','Obstacle directly ahead','sos'],['Stairs ahead','Slow down','stairs']];
function persist(){try{localStorage.setItem('visionguide',JSON.stringify({settings,places,contacts,journeys:settings.history?journeys:[],onboarded}))}catch{}}
function applySettings(){document.body.className=[settings.appearance==='Dark'||settings.appearance==='System'&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'',settings.contrast?'contrast':'',settings.reduce?'reduce':'',settings.screen?'sr-optimized':'',['auth-loading','landing','signin','signup','forgot','reset'].includes(page)?'public-experience':''].join(' ');document.documentElement.style.fontSize={Standard:'18px',Large:'21px','Extra large':'24px'}[settings.size]}
function speak(text, options={}) {
  text=String(text||'').trim();
  if (!text) return Promise.resolve(false);
  lastSpokenText=text;
  if (window.guidanceAPI) {
    return window.guidanceAPI.announce(text, { priority:70, interrupt:true, ...options });
  }
  return playSpeech(text);
}
function playSpeech(text) {
  lastSpokenText=text;
  if (!settings.voice) { voiceState='Voice is off'; refreshVoiceStatus(); toast('Voice is off. Turn it on in Accessibility.'); return Promise.resolve(false); }
  if (settings.screen) {
    const region = document.getElementById('guidance-announcement');
    if (region) { region.textContent=''; requestAnimationFrame(()=>region.textContent=text); }
    voiceState='Sent to your screen reader'; refreshVoiceStatus(); return Promise.resolve(true);
  }
  if (!('speechSynthesis' in window)) { voiceState='Speech is unavailable in this browser'; refreshVoiceStatus(); toast(voiceState); return Promise.resolve(false); }
  window.voiceCommandAPI?.pauseForSpeech?.();
  _finishSpeech(false, false);
  const id=++speechVersion;
  window.speechSynthesis.cancel();
  return new Promise(resolve => {
    speechResolver=resolve;
    const utterance=new SpeechSynthesisUtterance(text);
    utterance.rate=Number(settings.speed); utterance.volume=Number(settings.volume);
    utterance.lang='en-IN';
    utterance.onstart=()=>{if(id!==speechVersion)return;voiceState='Speaking';refreshVoiceStatus();};
    utterance.onend=()=>{if(id!==speechVersion)return;voiceState='Ready to repeat';refreshVoiceStatus();_finishSpeech(true);};
    utterance.onerror=e=>{if(id!==speechVersion)return;const expected=e.error==='canceled'||e.error==='interrupted';if(!expected){voiceState='Tap Repeat to try speech again';refreshVoiceStatus();toast('Speech could not play. The instruction remains on screen.');}_finishSpeech(false);};
    voiceState='Preparing voice'; refreshVoiceStatus();
    const estimated=Math.min(20000,Math.max(4000,text.split(/\s+/).length*550));
    speechWatchdog=setTimeout(()=>{if(id!==speechVersion)return;window.speechSynthesis.cancel();_finishSpeech(false);},estimated);
    window.speechSynthesis.speak(utterance);
  });
}
function _finishSpeech(played, resume=true) {
  clearTimeout(speechWatchdog); speechWatchdog=null;
  const resolve=speechResolver; speechResolver=null;
  if (resolve) resolve(Boolean(played));
  if (resume) window.voiceCommandAPI?.resumeAfterSpeech?.();
}
function _cancelSpeechPlayback() {
  speechVersion++;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  _finishSpeech(false);
}
window.guidanceAPI?.configure({player:playSpeech,cancel:_cancelSpeechPlayback});
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',3500)}
function go(to) {
  const publicPages = ['auth-loading','landing','signin','signup','forgot','reset'];
  if (!authenticated && !publicPages.includes(to)) to='landing';
  if (page === 'camera' && to !== 'camera') { stopCamera(); cameraDemo = false; cancelVoice(); }
  if (page === 'read' && to !== 'read') { stopOcrCamera(); }
  if (page === 'guidance' && to !== 'guidance') { paused = true; clearInterval(timer); }
  if (to === 'camera') { paused = true; clearInterval(timer); }
  if (['landing','signin','signup','forgot'].includes(to)) { authError=''; authMessage=''; }
  page=to; search=''; render(); window.scrollTo(0,0);
  requestAnimationFrame(()=>$('#main')?.focus({preventScroll:true}));
}
function brand(){return `<div class="brand"><span class="brandmark">${icon('compass')}</span>VisionGuide</div>`}
function publicHeader() {
  return `<header class="landing-header"><button class="landing-brand" data-action="landing" aria-label="VisionGuide home">${brand()}</button><nav aria-label="Public navigation"><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#safety">Safety</a></nav><div class="landing-header-actions">${btn('Sign in','signin','landing-login')}${btn('Get started '+icon('arrow'),'signup','landing-cta')}</div></header>`;
}
function landing() {
  return `<main class="landing-page" id="main" tabindex="-1">
    ${publicHeader()}
    <section class="landing-hero" aria-labelledby="landing-title">
      <div class="landing-hero-copy">
        <div class="landing-kicker"><span></span> Accessibility that moves with you</div>
        <h1 id="landing-title">The world feels clearer<br><em>when it speaks.</em></h1>
        <p>VisionGuide turns what is ahead into calm, timely guidance—so every walk can feel more familiar, focused and yours.</p>
        <div class="landing-hero-actions">${btn('Start your journey '+icon('arrow'),'signup','landing-primary')}</div>
        <div class="landing-assurance"><span>${icon('shield')} Privacy-first</span><span>${icon('voice')} Designed for listening</span><span>${icon('camera')} Camera stays on device</span></div>
      </div>
      <div class="landing-stage" aria-label="A preview of VisionGuide giving a clear walking instruction">
        <div class="stage-glow" aria-hidden="true"></div>
        <div class="stage-orbit orbit-one" aria-hidden="true"></div><div class="stage-orbit orbit-two" aria-hidden="true"></div>
        <div class="stage-route" aria-hidden="true"><svg viewBox="0 0 540 580" preserveAspectRatio="none"><path class="route-shadow" d="M86 520 C85 430 210 446 216 354 S171 227 276 204 S430 205 449 77"/><path class="route-line" d="M86 520 C85 430 210 446 216 354 S171 227 276 204 S430 205 449 77"/></svg><i class="route-dot dot-one"></i><i class="route-dot dot-two"></i><i class="route-dot dot-three"></i></div>
        <div class="stage-beacon">${icon('compass')}<span></span></div>
        <article class="stage-card stage-direction"><small>YOUR NEXT STEP</small><div>${icon('left')}<strong>Move slightly left</strong></div><p>Pole ahead · 1.5 m</p></article>
        <article class="stage-card stage-clear">${icon('check')}<span><small>PATH STATUS</small><strong>Clear ahead</strong></span></article>
        <article class="stage-card stage-read">${icon('read')}<span><small>TEXT DETECTED</small><strong>Platform 2</strong></span><span class="sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span></article>
        <div class="stage-caption"><span class="live-pulse"></span> Live guidance preview</div>
      </div>
    </section>
    <section class="landing-trust" aria-label="VisionGuide principles"><p>Built around one simple idea</p><strong>Less looking. More listening. More independence.</strong></section>
    <section class="landing-features" id="features" aria-labelledby="features-title"><div class="landing-section-heading"><span>ONE CLEAR SIGNAL AT A TIME</span><h2 id="features-title">Awareness without the noise.</h2><p>Each tool is designed to say only what matters, exactly when it matters.</p></div><div class="feature-grid">
      <article class="feature-card feature-blue"><span class="feature-number">01</span><div class="feature-icon">${icon('camera')}</div><h3>Hear what is ahead</h3><p>Camera guidance turns nearby objects into short, actionable voice cues.</p><div class="feature-demo"><span>${icon('left')}</span><strong>Move slightly left</strong><small>Object ahead · 1.5 m</small></div></article>
      <article class="feature-card feature-lime"><span class="feature-number">02</span><div class="feature-icon">${icon('navigate')}</div><h3>Walk with direction</h3><p>Live location, walking routes and spoken turns keep your next step simple.</p><div class="mini-route"><i></i><b></b><i></i><b></b><i></i></div></article>
      <article class="feature-card feature-paper"><span class="feature-number">03</span><div class="feature-icon">${icon('read')}</div><h3>Let text speak</h3><p>Point toward a sign or label and hear the important words read aloud.</p><blockquote>“Platform 2”</blockquote></article>
    </div></section>
    <section class="landing-process" id="how-it-works"><div class="process-visual" aria-hidden="true"><span class="process-ring ring-a"></span><span class="process-ring ring-b"></span><div class="process-core">${icon('voice')}</div><div class="process-word word-a">See</div><div class="process-word word-b">Understand</div><div class="process-word word-c">Guide</div></div><div class="process-copy"><span class="landing-label">HOW IT WORKS</span><h2>Technology in the background.<br>Confidence in the foreground.</h2><ol><li><b>01</b><span><strong>Choose your tool</strong><small>Camera, navigation or text reader.</small></span></li><li><b>02</b><span><strong>Move at your pace</strong><small>VisionGuide follows your live context.</small></span></li><li><b>03</b><span><strong>Hear the next useful step</strong><small>Short guidance, made to be acted on.</small></span></li></ol></div></section>
    <section class="landing-safety" id="safety"><div><span class="landing-label">BUILT WITH CARE</span><h2>Your senses lead.<br>VisionGuide supports.</h2></div><p>Guidance is designed as an accessibility aid, not a replacement for mobility skills, a cane, a guide dog, or awareness of your surroundings.</p>${btn('Create your account '+icon('arrow'),'signup','landing-safety-button')}</section>
    <section class="landing-final"><div class="final-compass">${icon('compass')}<span></span></div><span class="landing-label">YOUR NEXT STEP STARTS HERE</span><h2>A little more clarity.<br>A lot more possibility.</h2><div>${btn('Create an account '+icon('arrow'),'signup','landing-primary')}${btn('Sign in','signin','landing-final-link')}</div></section>
    <footer class="landing-footer"><button data-action="landing" class="landing-brand">${brand()}</button><p>Accessible guidance, designed around you.</p><span>VisionGuide · Experimental accessibility technology</span></footer>
  </main>`;
}
function authPage(mode) {
  const signUp=mode==='signup';
  const disabled=authBusy?'disabled aria-disabled="true"':'';
  return `<main class="auth-page" id="main" tabindex="-1"><section class="auth-story"><button data-action="landing" class="auth-brand" aria-label="Back to VisionGuide home">${brand()}</button><div class="auth-story-copy"><span class="landing-label">A CLEARER WAY FORWARD</span><h1>${signUp?'Make every step<br>feel more yours.':'Welcome back<br>to your next step.'}</h1><p>${signUp?'Set up VisionGuide around how you see, hear and move.':'Your tools, comfort settings and familiar places are ready when you are.'}</p></div><div class="auth-cue"><div class="auth-cue-icon">${icon(signUp?'navigate':'left')}</div><span><small>GUIDANCE PREVIEW</small><strong>${signUp?'Destination is ahead':'Move slightly left'}</strong><p>${signUp?'Continue for 40 m':'Path is clear after the pole'}</p></span><div class="auth-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div><p class="auth-story-note">${icon('shield')} Your camera feed is never stored by VisionGuide.</p></section><section class="auth-panel"><div class="auth-panel-inner"><button class="auth-back" data-action="landing">${icon('back')} Back to home</button><div class="auth-heading"><span>${signUp?'START YOUR JOURNEY':'GOOD TO HAVE YOU BACK'}</span><h2>${signUp?'Create your account':'Sign in to VisionGuide'}</h2><p>${signUp?'A calmer, clearer experience begins with your preferences.':'Continue to your personal accessibility workspace.'}</p></div>${authFeedback()}<form class="auth-form" id="auth-form" data-mode="${mode}">${signUp?'<label for="auth-name">Your name</label><div class="auth-input"><span aria-hidden="true">Aa</span><input id="auth-name" name="name" autocomplete="name" placeholder="How should we address you?" required maxlength="60" '+disabled+'></div>':''}<label for="auth-email">Email address</label><div class="auth-input">${icon('mail')}<input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required ${disabled}></div><div class="auth-label-row"><label for="auth-password">Password</label>${signUp?'<small>At least 8 characters</small>':''}</div><div class="auth-input">${icon('shield')}<input id="auth-password" name="password" type="password" autocomplete="${signUp?'new-password':'current-password'}" placeholder="Enter your password" required minlength="8" ${disabled}><button type="button" class="password-toggle" data-action="toggle-password" aria-label="Show password" ${disabled}>Show</button></div>${signUp?'<label class="auth-check"><input type="checkbox" required '+disabled+'><span>I agree to the Terms and acknowledge the Privacy Notice.</span></label>':'<div class="auth-options"><label class="auth-check"><input type="checkbox" name="remember" '+disabled+'><span>Keep me signed in</span></label><button type="button" data-action="forgot" '+disabled+'>Forgot password?</button></div>'}<button class="auth-submit" type="submit" ${disabled}>${authBusy?'Please wait…':signUp?'Create account':'Sign in'} ${authBusy?'':icon('arrow')}</button><p class="auth-prototype-note">Secure authentication by Supabase. VisionGuide never stores your password.</p></form><div class="auth-switch"><span>${signUp?'Already have an account?':'New to VisionGuide?'}</span><button data-action="${signUp?'signin':'signup'}" ${disabled}>${signUp?'Sign in':'Create an account'} ${icon('arrow')}</button></div><button class="auth-guest" data-action="guest" ${disabled}>Continue as guest</button></div></section></main>`;
}
function authFeedback(){return `${authError?`<div class="auth-feedback auth-feedback-error" role="alert">${icon('sos')}<span>${esc(authError)}</span></div>`:''}${authMessage?`<div class="auth-feedback auth-feedback-success" role="status">${icon('check')}<span>${esc(authMessage)}</span></div>`:''}`}
function authLoading(){return `<main class="auth-loading" id="main" tabindex="-1"><div class="auth-loading-mark">${icon('compass')}<span></span></div><div><strong>VisionGuide</strong><p>${esc(authError||'Preparing your secure space…')}</p></div>${authError?btn('Return home','landing','landing-secondary'):''}</main>`}
function forgotPassword(){return `<main class="auth-page" id="main" tabindex="-1"><section class="auth-story"><button data-action="landing" class="auth-brand">${brand()}</button><div class="auth-story-copy"><span class="landing-label">ACCOUNT RECOVERY</span><h1>A clear path<br>back in.</h1><p>Enter your account email and Supabase will send a secure password-reset link.</p></div><div class="auth-cue"><div class="auth-cue-icon">${icon('mail')}</div><span><small>SECURE EMAIL</small><strong>Check your inbox</strong><p>The recovery link is time limited.</p></span></div></section><section class="auth-panel"><div class="auth-panel-inner"><button class="auth-back" data-action="signin">${icon('back')} Back to sign in</button><div class="auth-heading"><span>RESET YOUR PASSWORD</span><h2>Find your account</h2><p>We will send instructions to your registered email address.</p></div>${authFeedback()}<form class="auth-form" id="forgot-form"><label for="recovery-email">Email address</label><div class="auth-input">${icon('mail')}<input id="recovery-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required ${authBusy?'disabled':''}></div><button class="auth-submit" type="submit" ${authBusy?'disabled':''}>${authBusy?'Sending…':'Send recovery link '+icon('arrow')}</button></form><div class="auth-switch"><span>Remembered your password?</span><button data-action="signin">Sign in ${icon('arrow')}</button></div></div></section></main>`}
function resetPassword(){return `<main class="auth-page" id="main" tabindex="-1"><section class="auth-story"><button data-action="landing" class="auth-brand">${brand()}</button><div class="auth-story-copy"><span class="landing-label">SECURE RECOVERY</span><h1>Choose a new<br>way back in.</h1><p>Create a strong password you do not use for another account.</p></div><div class="auth-cue"><div class="auth-cue-icon">${icon('shield')}</div><span><small>ACCOUNT SECURITY</small><strong>Recovery link verified</strong><p>Your new password is sent securely to Supabase.</p></span></div></section><section class="auth-panel"><div class="auth-panel-inner"><div class="auth-heading"><span>NEW PASSWORD</span><h2>Reset your password</h2><p>Use at least eight characters.</p></div>${authFeedback()}<form class="auth-form" id="reset-form"><label for="new-password">New password</label><div class="auth-input">${icon('shield')}<input id="new-password" name="password" type="password" autocomplete="new-password" minlength="8" required ${authBusy?'disabled':''}><button type="button" class="password-toggle" data-action="toggle-password">Show</button></div><label for="confirm-password">Confirm new password</label><div class="auth-input">${icon('shield')}<input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required ${authBusy?'disabled':''}></div><button class="auth-submit" type="submit" ${authBusy?'disabled':''}>${authBusy?'Updating…':'Update password '+icon('arrow')}</button></form></div></section></main>`}
function map(route=false){return `<div class="map ${route?'route-map':''}" role="img" aria-label="Illustrative map of Bandra West. ${route?'Demo route from your position north along Hill Road, then right to the station.':'Current location in Bandra West.'}"><svg viewBox="0 0 500 260" preserveAspectRatio="xMidYMid slice"><rect width="500" height="260" fill="#eaf0eb"/><g fill="#d5e3d5"><rect x="22" y="20" width="90" height="70" rx="13"/><rect x="290" y="150" width="88" height="85" rx="16"/><rect x="400" y="15" width="83" height="75" rx="10"/></g><g stroke="#fff" stroke-width="19" fill="none"><path d="M-10 112H510 M150-10V280 M265-10v290 M-10 223 510 38 M380-10v280"/></g><g fill="#67766e" font-family="sans-serif" font-size="11"><text x="170" y="104">HILL ROAD</text><text x="24" y="62">Bandra West</text><text x="300" y="190">Patwardhan</text><text x="314" y="205">Park</text><text x="315" y="35">Station Road</text></g>${route?'<path d="M150 200V112H265V48h82" fill="none" stroke="#174de4" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="347" cy="48" r="11" fill="#14213d" stroke="white" stroke-width="4"/>':''}<circle cx="150" cy="200" r="25" fill="#174de420"/><circle cx="150" cy="200" r="11" fill="#174de4" stroke="white" stroke-width="4"/></svg><span class="map-label">${route?'You → '+esc(destination?.name||'Bandra Railway Station'):'Bandra West, Mumbai'} · Demo map</span></div>`}
function heading(title,subtitle='',extra=''){return `<div class="page-heading"><div><h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div>${extra}</div>`}
function note(){return `<div class="notice">${icon('shield')}Prototype only. Guidance and locations are simulated.</div>`}
function toggle(key,label){return `<div class="setting"><label id="label-${key}">${label}</label><button class="switch" role="switch" aria-labelledby="label-${key}" aria-checked="${settings[key]}" data-toggle="${key}"></button></div>`}
function select(key,label,options){return `<div class="setting"><label for="${key}">${label}</label><select id="${key}" data-setting="${key}">${options.map(o=>{const [v,t]=Array.isArray(o)?o:[o,o];return `<option value="${v}" ${settings[key]===v?'selected':''}>${t}</option>`}).join('')}</select></div>`}
function accessibility(){return select('size','Text size',['Standard','Large','Extra large'])+toggle('voice','Voice guidance')+select('intensity','Alert intensity',['Low','Medium','Strong'])+toggle('contrast','High contrast')+select('appearance','Appearance',['System','Light','Dark'])+toggle('reduce','Reduce motion')}
function onboarding() {
  let body='';
  if(page==='welcome') body='<div class="welcome-title"><div class="eyebrow">A clearer way forward</div><h1>Your world.<br><span>Your next step.</span></h1><p class="intro">Hear simple directions for the things around you. Made for less looking and more listening.</p></div><div class="welcome-cue">'+icon('left')+'<div><small>SAMPLE VOICE GUIDANCE</small><h2>“Move slightly left.”</h2><p>Pole ahead · 1.5 m · Demo</p></div>'+btn(icon('voice'),'hear-example','round-button','aria-label="Listen to a sample direction"')+'</div>'+btn('Get Started '+icon('arrow'),'setup','primary wide')+btn('Accessibility Options','setup','text-button wide')+'<p class="welcome-note">Camera preview is real. Object awareness and directions are simulated.</p>';
  if(page==='setup') body='<div class="eyebrow">01 / YOUR COMFORT</div><h1>Let’s make this<br>work for you.</h1><p class="intro">Start with a preset, then adjust anything.</p><div class="preset-grid">'+btn(icon('voice')+'<strong>Listen first</strong><small>Large text · slower voice</small>','listen-preset','preset-card')+btn(icon('sun')+'<strong>More contrast</strong><small>Bold contrast · large text</small>','contrast-preset','preset-card')+'</div><div class="card">'+accessibility()+'</div><div class="live-preview-card"><small>LIVE PREVIEW</small><h2>'+icon('straight')+' Continue straight</h2><p>One clear instruction.</p></div>'+btn('Continue '+icon('arrow'),'permissions','primary wide');
  if(page==='permissions') body='<div class="eyebrow">02 / YOUR CHOICE</div><h1>You’re in control.</h1><p class="intro">Camera and microphone access are optional and requested only when you choose their controls.</p><div class="card permission-summary"><span class="iconbox">'+icon('camera')+'</span><h2>Camera preview + voice commands</h2><p>No recording or uploads. Live object detection runs in your browser. You can use the demo without a camera, and every feature still has an on-screen control.</p></div><div class="card">'+toggle('location','Demo location')+'<p class="muted">Use Bandra West as the sample starting point.</p>'+toggle('notifications','Demo notifications')+'<p class="muted">Show important updates inside the prototype.</p></div>'+btn('Open VisionGuide '+icon('arrow'),'complete-onboarding','primary wide');
  return '<main class="onboarding" id="main" tabindex="-1">'+brand()+body+'</main>';
}
function home() {
  const liveLocation=window.navigationUI?.getState?.()?.location;
  const locationTitle=liveLocation?`${Number(liveLocation.latitude).toFixed(5)}, ${Number(liveLocation.longitude).toFixed(5)}`:settings.location?'Location services ready':'Location is off';
  const locationCaption=liveLocation?'CURRENT LIVE POSITION':settings.location?'LIVE GPS STARTS WHEN NEEDED':'TURN ON LOCATION IN PRIVACY';
  return '<div class="home-heading"><div><div class="eyebrow">A little awareness. More independence.</div><h1>Your world.<br><span>Your next step.</span></h1></div><div class="home-location">'+icon('pin')+'<span>'+locationTitle+'<small>'+locationCaption+'</small></span></div></div>' +
  '<section class="guide-hero"><div class="hero-copy"><span class="hero-kicker">'+icon('camera')+' CAMERA GUIDE</span><h2>Hear what’s ahead.<br>Move with confidence.</h2><p>Simple spoken directions from live camera analysis. One clear action at a time.</p>'+btn(icon('camera')+' Start camera guide '+icon('arrow'),'camera','hero-primary')+'<div class="hero-secondary">'+btn(icon('shield')+' Camera privacy','privacy','hero-link')+'<span>Camera access is always your choice</span></div><div class="hero-footnote">'+icon('shield')+' Live analysis runs in your browser</div></div><div class="hero-cue"><div class="hero-cue-top"><span>LIVE CAMERA GUIDANCE</span>'+icon('voice')+'</div><div class="hero-arrow">'+icon('camera')+'</div><h3>Point ahead.<br>Hear what matters.</h3><div class="hero-obstacle">'+icon('shield')+'<span>On-device analysis<strong>Guidance begins after you start the camera</strong></span></div><div class="hero-wave">'+wave()+'<span>Short, useful cues spoken clearly.</span></div></div></section>' +
  '<div class="home-tools">'+btn('<span class="tool-icon">'+icon('navigate')+'</span><span><strong>Go somewhere</strong><small>Choose your destination</small></span>'+icon('arrow'),'navigate','tool-card')+btn('<span class="tool-icon">'+icon('read')+'</span><span><strong>Read a sign</strong><small>Use live camera text reading</small></span>'+icon('arrow'),'read','tool-card')+btn('<span class="tool-icon">'+icon('book')+'</span><span><strong>Get comfortable</strong><small>Practice at your own pace</small></span>'+icon('arrow'),'practice','tool-card')+'</div>'+
  '<div class="home-bottom"><section class="familiar-places"><div class="row section-title"><h2>Familiar places</h2>'+btn('Manage places '+icon('arrow'),'places','text-button')+'</div><div class="saved-shortcuts">'+places.slice(0,3).map(p=>'<button class="saved-shortcut" data-place="'+p.id+'"><span class="iconbox">'+icon(p.home?'home':p.name.includes('Station')?'train':'pin')+'</span><strong>'+esc(p.name)+'</strong><small>'+esc(p.address)+'</small></button>').join('')+'</div></section><section class="comfort-card"><div class="eyebrow">DESIGNED AROUND YOU</div><h2>Make it easier to use.</h2><p>Larger text, clearer contrast, and a voice that moves at your pace.</p>'+btn('Accessibility options '+icon('arrow'),'accessibility','text-button')+'</section></div>';
}
function placeRow(p){return `<button class="place-row" data-place="${p.id}"><span class="iconbox">${icon(p.home?'home':p.name.includes('Station')?'train':'pin')}</span><span class="place-copy"><strong>${esc(p.name)}</strong><small>${esc(p.address)}</small></span>${icon('arrow')}</button>`}
function empty(title,description,action,label){return `<div class="card empty">${icon('pin')}<h2>${title}</h2><p class="muted">${description}</p>${btn(label,action,'primary')}</div>`}
function navigate(){if(window.navigationUI)return window.navigationUI.render({places,settings});if(!settings.location)return heading('Navigate')+empty('Location unavailable','Enable location access to start navigation.','enable-location','Enable Location');return heading('Where would you like to go?','Choose a familiar place or add a destination.')+`<div class="grid"><section><label class="eyebrow" for="destination-search">Search destinations</label><input class="search" id="destination-search" placeholder="Search for a place" value="${esc(search)}"><div id="search-results">${destinationResults()}</div>${btn(icon('plus')+' Add Destination','add-destination','wide')}<h2 class="section-title">Recent places</h2><div class="card">${places.filter(p=>p.name!=='Home').slice(0,2).map(placeRow).join('')||'<p>No recent places yet.</p>'}</div></section><section class="card stack"><span class="eyebrow">Your starting point</span><h2>Bandra West, Mumbai</h2>${map()}<p class="muted">Choose a destination to begin.</p>${active?btn('Return to current journey','guidance','primary'):''}</section></div>`}
function destinationResults(){const found=places.filter(p=>(p.name+' '+p.address).toLowerCase().includes(search.toLowerCase()));return `<h2 class="section-title">Saved places</h2><div class="card" style="margin-bottom:18px">${found.map(placeRow).join('')||'<p>No places found. Add a destination below.</p>'}</div>`}
function preview(){if(!destination)return heading('Route preview')+empty('No destination','Choose a destination to begin.','navigate','Choose Destination');if(destination.unavailable)return heading('Route preview')+empty('Route unavailable','Try another destination.','navigate','Change Destination');return heading('Your route, at a glance.','A simple path to your destination.')+`<div class="grid"><section class="card">${map(true)}<div class="eyebrow" style="margin-top:24px">Destination</div><h2>${esc(destination.name)}</h2><p class="muted">From Bandra West, Mumbai</p><div class="route-summary"><div><strong>650 m</strong><small>Distance</small></div><div><strong>8 min</strong><small>Estimated time</small></div></div>${btn('Begin Navigation '+icon('arrow'),'begin','primary wide')}${btn('Change Destination','navigate','text-button wide')}</section><div class="stack"><div class="card"><span class="iconbox">${icon('voice')}</span><h2 style="margin-top:20px">One step at a time.</h2><p class="muted">Follow one clear instruction. Pause whenever you need.</p></div><div class="card practice-card"><h3>Demo journey</h3><p>Experience turns, obstacles, and a safe arrival through predefined guidance.</p>${note()}</div></div></div>`}
function instruction(s){return `<section class="card instruction ${s[5]||''}" ${s[5]?'role="alert"':'role="status"'} aria-live="${settings.screen?'polite':s[5]&&settings.intensity==='Strong'?'assertive':'polite'}"><div class="direction">${icon(s[2])}</div><h1>${s[0]}</h1><p>${s[1]}</p>${settings.detail==='Detailed'&&page==='guidance'?'<p>Stay on the path and follow the next instruction.</p>':''}<div class="voice">${icon('voice')} ${settings.voice?`Demo voice cue · “${s[0]}”`:'Voice guidance is off'}</div></section>`}
function guidance(){if(!active)return heading('Navigate')+empty('No active journey','Choose a destination to begin.','navigate','Choose Destination');if(!settings.location)return heading('Navigation paused')+empty('Location unavailable','Enable location access to start navigation.','enable-location','Enable Location');if(device!=='Connected')return heading('Navigation paused')+empty('Device disconnected','Navigation has been paused until the connection is restored.','reconnect','Reconnect');const s=sequence[step];return heading(step===8?'Destination reached':'On your way',esc(destination.name),`<span class="pill">${icon('navigate')} Demo journey</span>`)+`<div class="grid"><div>${instruction(s)}${step===8?btn('Finish Journey','finish','primary wide','style="margin-top:20px"'):`<div class="progress" aria-label="Journey progress"><span style="width:${step/8*100}%"></span></div><div class="row"><small>Demo step ${step+1} of 9</small><small>${paused?'Paused':'Playing'}</small></div><div class="demo-controls">${btn('Previous','previous','',step===0?'disabled':'')}${btn(paused?'Resume':'Pause','pause')}${btn('Next '+icon('arrow'),'next')}${btn('End Demo','end-demo','text-button')}</div>`}</div><div class="stack"><section class="card"><div class="row"><h2>Journey overview</h2>${icon('pin')}</div><div class="route-summary"><div><strong>${s[3]}</strong><small>Remaining</small></div><div><strong>${s[4]}</strong><small>ETA</small></div></div>${mapVisible?map(true):''}${btn(mapVisible?'Hide Map':'Show Map','map','text-button wide')}</section><div class="card"><div class="row"><h3>Voice guidance</h3>${btn(icon('voice'),'repeat','','aria-label="Repeat current instruction"')}</div><p class="muted">${settings.voice?'Listen to your current instruction again.':'Turn on voice guidance in Settings.'}</p></div></div></div>${note()}`}
function environment(){return heading('Around you','A simple view of your surroundings.')+`<div class="grid"><div class="stack"><section class="alert-box"><div class="eyebrow">Immediate</div><h2>${icon('sos')} Pole · 0.8 m · Front</h2><p>Move slightly left.</p>${btn('Preview safety alert','safety-stop','danger','style="margin-top:20px"')}</section><section class="card"><div class="eyebrow">Nearby</div><h2>${icon('person')} Person · 2.1 m · Right</h2><p class="muted">Keep to your path.</p></section><section class="card"><div class="eyebrow">Further</div><h2>${icon('car')} Vehicle · 6 m · Left</h2>${btn('Preview vehicle warning','safety-car','text-button')}</section></div><section class="card practice-card"><h2>Your next step comes first.</h2><p class="muted">These are sample objects. Try Camera guide to hear one clear direction for each situation.</p>${btn(icon('camera')+' Open Camera guide','camera','primary')}${btn('Start Navigation','navigate','primary','style="margin-top:22px"')}${note()}</section></div>`}
/* ── OCR Reader state ─────────────────────────────────────────────────── */
let ocrStream = null, ocrCamActive = false, ocrCameraState = 'off', ocrCameraError = '', ocrCameraRequest = 0;

function read() {
  const hist = window.ocrAPI ? window.ocrAPI.getHistory() : [];
  const histHtml = `<div class="ocr-history"><div class="ocr-section-heading"><div><span class="eyebrow">Recent scans</span><h3>Your latest text</h3></div><span class="ocr-count">${hist.length}</span></div><div class="ocr-hist-list">${hist.length
      ?
        hist.map(h => `<div class="ocr-hist-item">
          ${h.thumb ? `<img class="ocr-thumb" src="${h.thumb}" alt="">` : ''}
          <div class="ocr-hist-copy">
            <strong>${esc(h.text)}</strong>
            <small>${Math.round(h.conf)}% confidence · ${new Date(h.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small>
          </div>
          <button class="ocr-repeat-btn" data-action="ocr-speak" data-text="${esc(h.text)}" aria-label="Read ${esc(h.text)} aloud">${icon('voice')}</button>
        </div>`).join('')
      : `<div class="ocr-history-empty">${icon('activity')}<p>Your accepted scans will appear here.</p></div>`
    }</div></div>`;

  return heading('Read what’s ahead.', 'Point your camera at real-world text and hear the live result.', `<span class="pill">${icon('shield')} On-device OCR</span>`) +
  `<section class="ocr-workspace">
    <div class="ocr-layout">
    <section class="ocr-camera-section">
      <div class="ocr-panel-heading"><div><span class="eyebrow">Live camera</span><h2>${ocrCamActive?'Frame the text clearly':'Start live text reading'}</h2></div>${ocrCamActive?'<span class="live-pulse-label"><i></i> Camera live</span>':''}</div>
      ${ ocrCamActive
        ? `<div class="ocr-video-wrap">
            <video id="ocr-video" autoplay playsinline muted aria-label="OCR camera preview"></video>
            <canvas id="ocr-word-overlay" class="ocr-overlay-canvas" aria-hidden="true"></canvas>
            <span id="ocr-status-badge" class="ocr-status-badge ocr-badge-loading">Initialising OCR…</span>
          </div>
          <div class="ocr-controls">
            ${btn(icon('focus') + ' Scan Now', 'ocr-scan', 'primary')}
            ${btn(
              (window.ocrAPI?.isAuto?.() ? icon('pause') + ' Stop Auto' : icon('camera') + ' Auto Scan'),
              'ocr-auto',
              window.ocrAPI?.isAuto?.() ? 'ocr-auto-active' : ''
            )}
            ${btn('Turn off camera', 'ocr-stop', 'text-button')}
          </div>`
        : `<div class="ocr-start-card">
            <span class="ocr-icon-ring">${icon('read')}</span>
            <h2>${ocrCameraState === 'requesting' ? 'Allow camera access' : ocrCameraState === 'error' ? 'Camera unavailable' : 'Ready when you are'}</h2>
            <p>${ocrCameraState === 'requesting' ? 'Your browser may ask for camera permission.' : ocrCameraState === 'error' ? esc(ocrCameraError) : 'Point your camera at any sign, board, signal or label and VisionGuide will read it aloud.'}</p>
            <div class="ocr-use-cases"><span>Street signs</span><span>Menus</span><span>Labels</span><span>Platform boards</span></div>
            ${btn(icon('camera') + (ocrCameraState === 'requesting' ? ' Waiting for permission…' : ocrCameraState === 'error' ? ' Try camera again' : ' Start reading camera'), 'ocr-start', 'primary wide', ocrCameraState === 'requesting' ? 'disabled' : '')}
          </div>`
      }
    </section>

    <section class="ocr-results-section">
      <div class="ocr-result-card">
        <div class="ocr-section-heading"><div><span class="eyebrow">Live result</span><h2>${hist[0]?'Text detected':'Waiting for a scan'}</h2></div>${icon('voice')}</div>
        <div id="ocr-live-result" class="ocr-live-result">
          ${ hist.length && hist[0]
            ? `<div class="ocr-big-text">${esc(hist[0].text)}</div>
               <div class="ocr-meta">${Math.round(hist[0].conf)}% confidence</div>
               <div class="ocr-chips">
                 ${btn(icon('voice') + ' Read aloud', 'ocr-speak', 'primary', `data-text="${esc(hist[0].text)}"`)}
                 ${btn(icon(ocrCamActive?'focus':'camera') + (ocrCamActive?' Scan again':' Start camera'), ocrCamActive?'ocr-scan':'ocr-start')}
               </div>`
            : `<div class="ocr-placeholder">${icon('read')}<p><strong>Detected text appears here.</strong><span>Start the camera, hold it steady, then select Scan Now.</span></p></div>`
          }
        </div>
      </div>
      ${histHtml}
    </section>
    </div>
    <div class="ocr-privacy-strip">${icon('shield')}<span><strong>Private by design</strong><small>OCR runs in this browser. Camera frames and detected text are not uploaded by VisionGuide.</small></span></div>
  </section>`;
}
function primarySosContact(){return contacts.find(c=>c.primary)||contacts[0]||null}
function sosStatusText(){
  if(sosPhase==='locating')return ['Getting your live location…','Keep this page open while GPS finds your position.'];
  if(sosPhase==='sending')return ['Sending emergency SMS…','Your confirmed location is being sent securely.'];
  if(sosPhase==='delivered')return ['Emergency contact notified','The SMS provider confirmed delivery to the contact’s phone.'];
  if(['queued','accepted','sending','sent'].includes(sosPhase))return ['Emergency SMS is on its way',`Provider status: ${sosPhase}. Delivery confirmation will update here.`];
  if(sosPhase==='fallback')return ['Automatic SMS did not send','Open your phone’s Messages app below and press Send.'];
  if(['failed','undelivered','canceled','error'].includes(sosPhase))return ['Emergency SMS was not delivered',sosDetail||'Try again or use your phone to contact the person directly.'];
  return ['Send an emergency alert','VisionGuide will get fresh GPS and ask you to confirm before sending.'];
}
function sos(){
  const c=primarySosContact(),status=sosStatusText(),hasLocation=Boolean(sosLocation),busy=['locating','sending'].includes(sosPhase);
  const locationHtml=hasLocation?`<h2>${Number(sosLocation.latitude).toFixed(6)}, ${Number(sosLocation.longitude).toFixed(6)}</h2><p class="muted">Accuracy about ±${Math.max(1,Math.round(sosLocation.accuracy))} metres · <a href="${window.sosAPI.mapUrl(sosLocation)}" target="_blank" rel="noopener">Open Google Maps pin</a></p>`:`<h2>Captured when you activate SOS</h2><p class="muted">Precise location permission is required.</p>`;
  const mainAction=!c?'sos-add-contact':busy?'confirm-sos':sosActive||sosPhase==='fallback'?'confirm-sos':'confirm-sos';
  const mainLabel=!c?'Add emergency contact':busy?status[0]:sosActive||sosPhase==='fallback'?'Send another SOS':'Prepare SOS alert';
  return heading('Help is close.','Send your live location to someone you trust.')+`<div class="grid"><section class="alert-box sos-alert sos-${esc(sosPhase)}" aria-live="polite">${icon(sosPhase==='delivered'?'check':'sos')}<div class="eyebrow">Emergency SMS</div><h1>${esc(status[0])}</h1><p>${esc(status[1])}</p>${sosDetail&&!['failed','undelivered','canceled','error'].includes(sosPhase)?`<p class="sos-detail">${esc(sosDetail)}</p>`:''}<p><strong>This contacts your saved person, not police, ambulance, or other emergency services.</strong></p>${btn(mainLabel,mainAction,'danger wide',`style="margin-top:26px" ${busy?'disabled aria-disabled="true"':''}`)}${(sosActive||sosPhase==='fallback')?btn('Clear this status','clear-sos','text-button wide'):''}</section><section class="card stack"><div><div class="eyebrow">Live location</div>${locationHtml}</div><div><div class="eyebrow">Primary emergency contact</div><h2>${c?esc(c.name):'No contact added'}</h2><p class="muted">${c?esc(c.relationship)+' · '+esc(c.phone):'Add a real mobile number before using SOS.'}</p></div>${sosPhase==='fallback'&&sosFallback?`<div class="sos-fallback"><strong>Phone fallback ready</strong><p class="muted">The message is prepared but has not been sent.</p>${btn('Open Messages app','open-sms-app','primary wide')}${btn('Copy emergency text','copy-sos-message','wide')}</div>`:''}${btn('Manage Emergency Contacts','contacts','wide')}</section></div>`;
}
function settingsPage(accessOnly=false){return heading(accessOnly?'Made for you.':'Settings',accessOnly?'Adjust how VisionGuide looks and feels.':'Your guidance, your preferences.')+`<div class="grid"><div class="stack"><section class="card"><h2>Accessibility</h2><div class="preset-grid">${btn(icon('voice')+' Listen first','listen-preset','preset-card')}${btn(icon('sun')+' More contrast','contrast-preset','preset-card')}</div>${accessibility()}${toggle('screen','Screen reader optimization')}</section>${accessOnly?'':`<section class="card"><h2>Navigation</h2>${select('detail','Guidance detail',['Minimal','Standard','Detailed'])}${select('distance','Alert distance',['Near · 1.5 m','Earlier · 3 m'])}${toggle('auto','Auto-start guidance')}</section><section class="card"><h2>Feedback</h2>${select('speed','Voice speed',[['0.8','Slower'],['1','Normal'],['1.2','Faster']])}${select('volume','Voice volume',[['0.4','Low'],['0.7','Medium'],['1','Full']])}${btn('Preview voice feedback','test-voice','text-button')}</section>`}</div><div class="stack"><section class="card practice-card"><div class="eyebrow">Live preview</div><h2>${icon('straight')} Continue straight</h2><p>Continue for 40 m.</p>${btn('Preview guidance','test-voice','text-button')}</section>${accessOnly?'':`<section class="card"><h2>Safety</h2>${toggle('confirm','SOS confirmation')}<p class="muted">A confirmation step is always shown before a real emergency SMS is sent.</p>${btn('Emergency Contacts '+icon('arrow'),'contacts','text-button')}</section><section class="card"><h2>Privacy</h2>${toggle('location','Location preference')}${toggle('history','Keep journey history')}${btn('Privacy Center '+icon('arrow'),'privacy','text-button')}</section><section class="card"><h2>VisionGuide Device</h2><p>${device} ${device==='Connected'?'· Battery 82%':''}</p>${btn(device==='Connected'?'Disconnect demo device':'Reconnect',device==='Connected'?'disconnect':'reconnect','text-button')}</section><section class="card"><h2>Your places</h2>${btn('Manage Saved Places '+icon('arrow'),'places','text-button')}${btn('Replay onboarding','replay-onboarding','text-button wide')}</section>`}</div></div>`}
function activity(){return heading('Recent journeys','A familiar path, remembered.')+`<section class="card">${settings.history&&journeys.length?journeys.map((j,i)=>`<button class="place-row" data-journey="${i}"><span class="iconbox">${icon('activity')}</span><span class="place-copy"><strong>${esc(j.name)}</strong><small>${esc(j.time)} · ${j.distance}</small></span>${icon('arrow')}</button>`).join(''):`<div class="empty"><h2>${settings.history?'No journeys yet':'Journey history is off'}</h2><p class="muted">${settings.history?'Your completed journeys will appear here.':'Enable journey history in Privacy Center to keep future journeys.'}</p>${btn(settings.history?'Start Navigation':'Privacy Center',settings.history?'navigate':'privacy','primary')}</div>`}</section>`}
function placesPage(){return heading('Your saved places','Keep familiar destinations close.',btn(icon('plus')+' Add Place','add-place','primary'))+`<section class="card">${places.map(p=>`<div class="contact">${placeRow(p)}<div class="list-actions">${btn('Rename','rename-place','','data-id="'+p.id+'"')}${btn(p.home?'Home place':'Set as Home','set-home','',`data-id="${p.id}" ${p.home?'disabled':''}`)}${btn('Remove','remove-place','',`data-id="${p.id}"`)}</div></div>`).join('')||'<p>No saved places. Add a place above.</p>'}</section>`}
function contactsPage(){return heading('Emergency contacts','The people you trust.',btn(icon('plus')+' Add Contact','add-contact','primary'))+`<section class="card">${contacts.map(c=>`<div class="contact"><div class="row"><h2>${esc(c.name)}</h2>${c.primary?'<span class="pill">Primary</span>':''}</div><p class="muted">${esc(c.relationship)} · ${esc(c.phone)}</p><div class="list-actions">${btn('Edit','edit-contact','',`data-id="${c.id}"`)}${btn('Set Primary','primary-contact','',`data-id="${c.id}" ${c.primary?'disabled':''}`)}${btn('Remove','remove-contact','',`data-id="${c.id}"`)}</div></div>`).join('')||'<p>No emergency contacts. Add a real mobile number for someone who has agreed to receive your emergency alerts.</p>'}</section><p class="notice">Contacts stay in this browser. During SOS, only the selected phone number and live location are sent through the server to the SMS provider.</p>`}
function privacy() {
  return heading('Your privacy. Your choice.','Clear controls, without the small print.')+'<div class="stack" style="max-width:760px"><section class="card"><h2>'+icon('camera')+' Camera preview</h2><p class="muted">Camera access is optional and requested only after you choose Allow camera access. The live feed stays in the video preview. It is not recorded or uploaded.</p><p class="muted">Camera access stops when you leave Camera guide, hide the app, or end your session. Camera capture never includes audio.</p>'+btn('Open Camera guide','camera','text-button')+'</section><section class="card"><h2>'+icon('voice')+' Voice commands</h2><p class="muted">Microphone access is optional and requested only after you select Voice commands. Listening stops when you select Stop listening, hide the app, or close the page.</p><p class="muted">Recognition availability and processing depend on your browser and operating system.</p></section><section class="card"><h2>Guidance</h2><p class="muted">Live camera analysis and walking guidance are experimental accessibility aids. Do not rely on VisionGuide as a replacement for mobility skills or awareness of your surroundings.</p></section><section class="card"><h2>Emergency alerts and location</h2><p class="muted">SOS requests a fresh precise location only after you activate it. After confirmation, the primary contact’s phone number and your coordinates are sent to the server and SMS provider. The message includes a Google Maps pin. VisionGuide does not contact public emergency services.</p>'+toggle('location','Allow location features')+'</section><section class="card"><h2>Journey history</h2><p class="muted">Keep previous journeys in this browser. Turning this off clears saved journey history.</p>'+toggle('history','Keep journey history')+'</section></div>';
}
function practicePage(){return heading('A little practice. A lot of clarity.',"Learn VisionGuide’s navigation alerts before using navigation.")+(!practice?`<section class="card empty">${icon('book')}<h2>Find your pace.</h2><p class="muted">Try six guidance cues. Listen and move between them when you’re ready.</p>${btn('Start Practice','start-practice','primary')}</section>`:`<div class="grid"><div>${instruction([...practiceCommands[practiceIndex],null,null,practiceIndex===4?'stop':practiceIndex>=3?'warning':''])}${btn('Finish Practice','finish-practice','primary wide','style="margin-top:20px"')}</div><section class="card"><h2>Choose a cue</h2><div class="stack" style="margin-top:22px;gap:10px">${practiceCommands.map((c,i)=>btn(icon(c[2])+' '+c[0],'practice-cue',i===practiceIndex?'selected':'',`data-id="${i}" aria-pressed="${i===practiceIndex}"`)).join('')}</div></section></div>`)}
function refreshProductClaims() {
  const welcomeNote = document.querySelector('.welcome-note');
  if (welcomeNote) welcomeNote.textContent = 'Live analysis is experimental. Camera-free directions are simulated.';
  const heroFootnote = document.querySelector('.hero-footnote');
  if (heroFootnote) heroFootnote.textContent = 'Live analysis runs in your browser';
  const boundary = document.querySelector('.prototype-boundary');
  if (boundary && page === 'camera' && cameraDemo) boundary.textContent = 'Camera-free demonstration. All directions and distances are predefined.';
}
function render() {
  const previousFocus = document.activeElement;
  const focusedAction = previousFocus?.dataset?.action;
  const focusedId = previousFocus?.dataset?.id;
  applySettings();
  if (page === 'auth-loading') { $('#app').innerHTML = authLoading(); window.navigationUI?.unmountMap?.(); return; }
  if (page === 'landing') { $('#app').innerHTML = landing(); window.navigationUI?.unmountMap?.(); return; }
  if (page === 'signin' || page === 'signup') { $('#app').innerHTML = authPage(page); document.querySelector('.auth-guest')?.remove(); window.navigationUI?.unmountMap?.(); return; }
  if (page === 'forgot') { $('#app').innerHTML = forgotPassword(); window.navigationUI?.unmountMap?.(); return; }
  if (page === 'reset') { $('#app').innerHTML = resetPassword(); window.navigationUI?.unmountMap?.(); return; }
  if (['welcome','setup','permissions'].includes(page)) { $('#app').innerHTML = onboarding(); refreshProductClaims(); return; }
  const sections = [['home','Home'],['camera','Camera guide'],['navigate','Navigate'],['read','Read'],['more','More']];
  const current = ['preview','guidance'].includes(page) ? 'navigate' : page;
  const content = ({home,navigate,preview,guidance,environment,read,sos,settings:()=>settingsPage(),accessibility:()=>settingsPage(true),activity,places:placesPage,contacts:contactsPage,privacy,practice:practicePage,camera:cameraPage}[page]||home)();
  $('#app').innerHTML = '<div class="product-shell"><header class="product-header"><button class="brand-button" data-action="home" aria-label="VisionGuide home">'+brand()+'</button><nav class="desktop-nav" aria-label="Main navigation">'+sections.map(([p,t])=>btn(t,p,current===p?'active':'',current===p?'aria-current="page"':'')).join('')+'</nav><div class="header-utilities">'+btn(icon('settings'),'accessibility','access-button','aria-label="Accessibility options"')+btn(icon('sos')+' SOS','sos','header-sos')+'</div></header><main class="content page-'+page+'" id="main" tabindex="-1">'+content+'</main><footer class="product-footer"><span>'+icon('compass')+' VisionGuide · Navigate with confidence</span><span>Built around your next step.</span></footer><nav class="bottomnav" aria-label="Mobile navigation">'+[['home','Home'],['camera','Guide'],['sos','SOS'],['navigate','Navigate'],['more','More']].map(([p,t])=>btn(icon(p==='more'?'settings':p)+t,p,(p==='sos'?'sos ':'')+(current===p?'active':''),current===p?'aria-current="page"':'')).join('')+'</nav></div>';
  document.querySelector('.header-utilities')?.insertAdjacentHTML?.('beforeend', btn(icon('logout'),'sign-out','access-button','aria-label="Sign out" title="Sign out"'));
  attachCamera();
  attachOcr();
  if (page === 'navigate') window.navigationUI?.mount?.();
  else window.navigationUI?.unmountMap?.();
  refreshProductClaims();
  if (focusedAction) {
    const replacement = Array.from(document.querySelectorAll('button')).find(b => b.dataset.action === focusedAction && b.dataset.id === focusedId && !b.disabled);
    if (replacement) replacement.focus({preventScroll:true});
    else if (page === 'camera') document.querySelector('[data-action="camera-repeat"]')?.focus({preventScroll:true});
  }
}
/* ── OCR camera attachment ─────────────────────────────────────── */
function attachOcr() {
  if (page !== 'read') return;
  const vid = document.getElementById('ocr-video');
  if (!vid || !ocrCamActive) return;
  // Video already has stream — re-attach if needed
  if (ocrStream && vid.srcObject !== ocrStream) vid.srcObject = ocrStream;
  const playing = vid.play();
  if (playing?.catch) playing.catch(() => {});
  if (window.ocrAPI) window.ocrAPI.setVideo(vid);
}
async function startOcrCamera() {
  if (ocrCameraState === 'requesting' || ocrCameraState === 'live') return;
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    ocrCameraState = 'error';
    ocrCameraError = 'Camera access requires a supported browser and a secure connection.';
    render();
    return;
  }
  stopOcrCamera();
  if (typeof stopCamera === 'function') { stopCamera(); cameraDemo = false; }
  ocrCameraState = 'requesting';
  ocrCameraError = '';
  const requestId = ++ocrCameraRequest;
  render();
  try {
    const cameraConfig = window.VisionGuideConfig?.camera || {};
    const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:cameraConfig.width || 1280},height:{ideal:cameraConfig.height || 720}},audio:false});
    if (requestId !== ocrCameraRequest || page !== 'read' || document.hidden) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    ocrStream = stream;
    ocrCamActive = true;
    ocrCameraState = 'live';
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (ocrStream !== stream) return;
      window.ocrAPI?.cancelPending?.();
      ocrStream = null;
      ocrCamActive = false;
      ocrCameraState = 'error';
      ocrCameraError = 'The camera stopped. Reconnect it to continue reading.';
      if (page === 'read') render();
    }));
    render();
    if (window.ocrAPI) {
      window.ocrAPI.loadWorker(pct => {
        const badge = document.getElementById('ocr-status-badge');
        if (badge && pct < 100) badge.textContent = `⏳ Loading OCR… ${pct}%`;
      }).catch(() => toast('OCR could not load. Check your connection and try again.'));
    }
  } catch (err) {
    if (requestId !== ocrCameraRequest || page !== 'read') return;
    ocrCamActive = false;
    ocrCameraState = 'error';
    ocrCameraError = ({NotAllowedError:'Camera access was not allowed. Enable it in your browser site permissions, then try again.',NotFoundError:'No camera was found on this device.',NotReadableError:'The camera may be in use by another app.'})[err.name] || 'The camera could not start. Try again.';
    render();
    toast(ocrCameraError);
  }
}
function stopOcrCamera() {
  ocrCameraRequest++;
  if (window.ocrAPI) window.ocrAPI.cancelPending();
  if (ocrStream) { ocrStream.getTracks().forEach(t => t.stop()); ocrStream = null; }
  ocrCamActive = false;
  ocrCameraState = 'off';
  ocrCameraError = '';
}

document.addEventListener('click', async e => {
  const control = e.target.closest('button');
  const action = control?.dataset.action;
  if (!action) return;
  if (['landing', 'signin', 'signup', 'forgot'].includes(action)) {
    e.stopImmediatePropagation();
    go(action);
    return;
  }
  if (action === 'complete-onboarding') {
    e.stopImmediatePropagation();
    onboarded = true;
    persist();
    go('home');
    return;
  }
  if (action === 'toggle-password') {
    e.stopImmediatePropagation();
    const input = control.closest('.auth-input')?.querySelector('input');
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    control.textContent = reveal ? 'Hide' : 'Show';
    control.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    return;
  }
  if (action === 'sign-out') {
    e.stopImmediatePropagation();
    authBusy = true;
    try {
      if (authenticated) await window.supabaseAuth?.signOut();
      authenticated = false;
      passwordRecovery = false;
      go('landing');
      toast('You have been signed out.');
    } catch (error) {
      toast(friendlyAuthError(error));
    } finally {
      authBusy = false;
    }
  }
});
function friendlyAuthError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'The email or password is incorrect.';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) return 'Confirm your email address before signing in.';
  if (code === 'user_already_exists' || message.includes('already registered')) return 'An account already exists for this email. Try signing in instead.';
  if (code === 'weak_password' || message.includes('password')) return error?.message || 'Use a stronger password with at least eight characters.';
  if (code.includes('rate_limit') || message.includes('rate limit')) return 'Too many attempts. Wait a few minutes, then try again.';
  if (message.includes('fetch') || message.includes('network')) return 'Could not reach the secure sign-in service. Check your connection and try again.';
  return error?.message || 'Authentication could not be completed. Please try again.';
}
document.addEventListener('submit', async e => {
  const form = e.target;
  if (!['auth-form', 'forgot-form', 'reset-form'].includes(form.id)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (authBusy) return;
  const data = new FormData(form);
  authBusy = true;
  authError = '';
  authMessage = '';
  render();
  try {
    if (form.id === 'auth-form') {
      const mode = form.dataset.mode;
      const credentials = { email: String(data.get('email') || '').trim(), password: String(data.get('password') || '') };
      const result = mode === 'signup'
        ? await window.supabaseAuth.signUp({ ...credentials, name: String(data.get('name') || '').trim() })
        : await window.supabaseAuth.signIn(credentials);
      if (result.error) throw result.error;
      if (result.data?.session) {
        authenticated = true;
        authBusy = false;
        go(onboarded ? 'home' : 'welcome');
        toast(mode === 'signup' ? 'Your VisionGuide account is ready.' : 'Welcome back to VisionGuide.');
        return;
      }
      authMessage = `Check ${credentials.email} for the confirmation link, then sign in.`;
    } else if (form.id === 'forgot-form') {
      const email = String(data.get('email') || '').trim();
      const result = await window.supabaseAuth.requestPasswordReset(email);
      if (result.error) throw result.error;
      authMessage = `If an account exists for ${email}, a secure recovery link is on its way.`;
    } else {
      const password = String(data.get('password') || '');
      const confirmation = String(data.get('confirmPassword') || '');
      if (password !== confirmation) throw new Error('The two passwords do not match.');
      const result = await window.supabaseAuth.updatePassword(password);
      if (result.error) throw result.error;
      passwordRecovery = false;
      authBusy = false;
      authMessage = '';
      go(onboarded ? 'home' : 'welcome');
      toast('Your password has been updated.');
      return;
    }
  } catch (error) {
    authError = friendlyAuthError(error);
  }
  authBusy = false;
  render();
}, true);
function modal(title,body){lastFocus=document.activeElement;$('#modal').innerHTML=`<h2>${title}</h2>${body}`;$('#modal').showModal()}
function closeModal(){$('#modal').close();if(lastFocus?.isConnected)lastFocus.focus()}
function formDialog(type,id){
  const item=type==='contact'?contacts.find(c=>c.id===id):places.find(p=>p.id===id);
  const contactFields=`<label for="relationship">Relationship</label><input id="relationship" name="relationship" required maxlength="40" value="${esc(item?.relationship||'')}"><label for="phone">Mobile number</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" name="phone" required minlength="10" maxlength="25" placeholder="+91 98765 43210" value="${esc(item?.phone||'')}"><p class="muted">Indian 10-digit mobile numbers are saved with +91 automatically.</p>`;
  const placeFields=`<label for="address">Address</label><input id="address" name="address" required maxlength="120" value="${esc(item?.address||'')}">${!item?'<p class="muted">New addresses can be saved. Route previews are available for the four sample places.</p>':''}`;
  modal(item?'Edit '+(type==='contact'?'contact':'place'):'Add '+(type==='contact'?'contact':'destination'),`<form id="edit-form" data-type="${type}" data-id="${id||''}"><label for="item-name">Name</label><input id="item-name" name="name" required maxlength="60" value="${esc(item?.name||'')}">${type==='contact'?contactFields:placeFields}<div class="list-actions">${btn('Cancel','close-modal')}<button type="submit" class="primary">Save</button></div></form>`);
}
function startTimer(){clearInterval(timer);if(active&&!paused&&step<8&&device==='Connected'&&settings.location){timer=setInterval(()=>advance(1),7000)}}
function advance(n){step=Math.max(0,Math.min(8,step+n));if(step===8||sequence[step][5]){paused=true;clearInterval(timer)}speak(sequence[step][0]+'. '+sequence[step][1]);render()}
function finish(completed){clearInterval(timer);if(settings.history)journeys.unshift({name:destination.name,time:'Today · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),distance:completed?'650 m':`${Math.round(step/8*650)} m`,duration:completed?'8 min':'Paused early',status:completed?'Completed':'Ended early'});active=false;paused=true;persist();go('activity');toast(completed?'Journey completed. Welcome to your destination.':'Demo journey ended.')}
function clearSosStatus(){sosActive=false;sosPhase='idle';sosDetail='';sosLocation=null;sosPreparedContact=null;sosMessageId='';sosFallback=null;render()}
function showSosFallback(error){
  if(!sosLocation||!sosPreparedContact)return;
  sosActive=false;sosPhase='fallback';sosDetail=error?.message||'Automatic SMS could not be sent.';
  sosFallback={phone:sosPreparedContact.phone,message:window.sosAPI.fallbackMessage(sosLocation),url:window.sosAPI.smsUrl(sosPreparedContact.phone,sosLocation)};
  render();
  modal('Automatic SMS did not send',`<p>${esc(sosDetail)}</p><p><strong>No message has been sent yet.</strong> Open your phone’s Messages app, check the recipient and press Send.</p><div class="list-actions">${btn('Close','close-modal')}${btn('Open Messages app','open-sms-app','danger')}${btn('Copy text','copy-sos-message','primary')}</div>`);
  speak('Automatic emergency SMS did not send. Use the Open Messages app button and press Send.');
}
async function prepareSosAlert(){
  if($('#modal')?.open)closeModal();
  const contact=primarySosContact();
  if(!contact){go('contacts');formDialog('contact');speak('Add a real emergency contact phone number first.');return false}
  const phone=window.sosAPI?.normalizePhone(contact.phone);
  if(!window.sosAPI?.isValidPhone(phone)){
    modal('Check the emergency number',`<p>${esc(contact.name)} does not have a valid mobile number with a country code.</p><p class="muted">For India, enter a 10-digit mobile number or use +91 followed by the number.</p><div class="list-actions">${btn('Cancel','close-modal')}${btn('Edit Contact','edit-sos-contact','primary',`data-id="${contact.id}"`)}</div>`);
    speak('The emergency contact phone number is invalid. Edit it before sending SOS.');return false;
  }
  sosPhase='locating';sosDetail='';sosActive=false;sosFallback=null;render();speak('Getting your precise live location.');
  try{
    sosLocation=await window.sosAPI.getFreshLocation();settings.location=true;persist();
    sosPreparedContact={...contact,phone};sosPhase='ready';render();
    const accuracy=Math.max(1,Math.round(sosLocation.accuracy)),link=window.sosAPI.mapUrl(sosLocation);
    modal('Confirm emergency SMS',`<p>Send an emergency alert to <strong>${esc(contact.name)}</strong> at <strong>${esc(phone)}</strong>?</p><div class="detail-grid sos-confirm-grid"><div><small>Latitude</small><strong>${Number(sosLocation.latitude).toFixed(6)}</strong></div><div><small>Longitude</small><strong>${Number(sosLocation.longitude).toFixed(6)}</strong></div><div><small>GPS accuracy</small><strong>About ±${accuracy} m</strong></div><div><small>Map pin</small><strong><a href="${link}" target="_blank" rel="noopener">Preview pin</a></strong></div></div>${accuracy>100?'<p class="sos-warning" role="alert">GPS accuracy is low. Move outdoors for a better pin, or send now if help is urgent.</p>':''}<p class="muted">This sends a real SMS through the configured provider. It does not call public emergency services.</p><div class="list-actions">${btn('Cancel','cancel-sos-preparation')}${btn('Refresh GPS','confirm-sos')}${btn('Send emergency SMS','send-sos','danger')}</div>`);
    speak(`Location ready with accuracy about ${accuracy} metres. Confirm emergency again to send a real SMS to ${contact.name}, or say cancel emergency.`);return true;
  }catch(error){sosPhase='error';sosDetail=error.message;render();modal('Live location is required',`<p>${esc(error.message)}</p><p class="muted">On mobile, turn on Precise Location for this browser. The deployed app must use HTTPS.</p><div class="list-actions">${btn('Close','close-modal')}${btn('Try GPS again','confirm-sos','primary')}</div>`);speak(error.message);return false}
}
async function refreshSosStatus(messageId=sosMessageId){
  if(!messageId||messageId!==sosMessageId)return false;
  try{
    const result=await window.sosAPI.checkStatus(messageId);
    if(messageId!==sosMessageId)return false;
    sosPhase=result.status;sosActive=!['failed','undelivered','canceled'].includes(result.status);
    sosDetail=result.status==='delivered'?'Delivery confirmed by the SMS provider.':`SMS provider status: ${result.status}.`;
    if(['failed','undelivered','canceled'].includes(result.status)){showSosFallback(new Error(`The SMS provider reported “${result.status}”.`));return true}
    render();if(result.status==='delivered')speak('Emergency SMS delivery confirmed. Your emergency contact has been notified.');
    return Boolean(result.terminal);
  }catch{return false}
}
async function monitorSosStatus(messageId){
  for(let attempt=0;attempt<8&&messageId===sosMessageId;attempt++){await new Promise(resolve=>setTimeout(resolve,4000));if(await refreshSosStatus(messageId))return}
  if(messageId===sosMessageId&&!['delivered','failed','undelivered','canceled'].includes(sosPhase)){sosDetail='The SMS request was accepted, but final delivery confirmation is still pending.';render()}
}
async function sendSosAlert(){
  if(!sosPreparedContact||!sosLocation)return prepareSosAlert();
  closeModal();sosPhase='sending';sosDetail='';render();speak('Sending the emergency SMS now.');
  try{
    const result=await window.sosAPI.sendAlert(sosPreparedContact,sosLocation);
    sosMessageId=result.messageId;sosPhase=result.status||'queued';sosActive=true;sosDetail='The SMS provider accepted the alert. Waiting for delivery confirmation.';render();
    speak('Emergency SMS accepted by the provider. Waiting for delivery confirmation.');void monitorSosStatus(result.messageId);return true;
  }catch(error){showSosFallback(error);return false}
}
document.addEventListener('input',e=>{if(e.target.id==='destination-search'){search=e.target.value;$('#search-results').innerHTML=destinationResults()}});
document.addEventListener('change',e=>{const key=e.target.dataset.setting;if(key){settings[key]=e.target.value;persist();applySettings();toast('Preference updated')}});
document.addEventListener('submit',e=>{
  if(e.target.id==='auth-form'){e.preventDefault();authenticated=true;persist();go(onboarded?'home':'welcome');toast(e.target.dataset.mode==='signup'?'Your VisionGuide space is ready.':'Welcome back to VisionGuide.');return}
  if(e.target.id!=='edit-form')return;e.preventDefault();
  const f=e.target,data=new FormData(f),id=Number(f.dataset.id),type=f.dataset.type,item={id:id||Date.now(),name:data.get('name').trim()};
  if(!item.name)return;
  if(type==='contact'){
    const phone=window.sosAPI?.normalizePhone(data.get('phone'))||data.get('phone').trim();
    if(!window.sosAPI?.isValidPhone(phone)){toast('Enter a valid mobile number. For India, use 10 digits or +91.');document.getElementById('phone')?.focus();return}
    Object.assign(item,{relationship:data.get('relationship').trim(),phone,primary:id?contacts.find(c=>c.id===id).primary:contacts.length===0});
    contacts=id?contacts.map(c=>c.id===id?item:c):[...contacts,item];
  }else{
    Object.assign(item,{address:data.get('address').trim(),home:id?places.find(p=>p.id===id).home:false,unavailable:id?places.find(p=>p.id===id).unavailable:true});
    places=id?places.map(p=>p.id===id?item:p):[...places,item];
  }
  closeModal();persist();render();toast(type==='contact'?'Contact saved':'Place saved');
});
// ── OCR click handler (separate, runs first) ───────────────────────
document.addEventListener('click', e => {
  const el = e.target.closest('button');
  if (!el) return;
  const a = el.dataset.action;
  if (!a) return;
  switch (a) {
    case 'ocr-start': startOcrCamera(); e.stopImmediatePropagation(); break;
    case 'ocr-scan':
      if (window.ocrAPI && window.ocrAPI.isReady()) {
        window.ocrAPI.scanOnce().then(r => { if (r?.accepted) render(); });
      } else { toast('OCR engine still loading. Please wait.'); }
      e.stopImmediatePropagation(); break;
    case 'ocr-auto':
      if (window.ocrAPI) {
        if (window.ocrAPI.isAuto()) { window.ocrAPI.stopAuto(); toast('Auto-scan stopped.'); }
        else if (window.ocrAPI.startAuto()) toast('Auto-scan started — scanning periodically.');
        else toast('OCR is still loading. Wait for the ready message before auto-scan.');
        render();
      }
      e.stopImmediatePropagation(); break;
    case 'ocr-stop': stopOcrCamera(); render(); e.stopImmediatePropagation(); break;
    case 'ocr-speak': {
      const t = el.dataset.text || '';
      if (t) speak('Text detected: ' + t);
      toast(settings.voice ? 'Reading: ' + t : 'Voice is off. Enable it in Accessibility.');
      e.stopImmediatePropagation(); break;
    }
  }
});
document.addEventListener('click', e => {
  const el=e.target.closest?.('button'),a=el?.dataset.action;
  if(!['confirm-sos','send-sos','clear-sos','cancel-sos-preparation','open-sms-app','copy-sos-message','edit-sos-contact'].includes(a))return;
  e.preventDefault();e.stopImmediatePropagation();
  if(a==='confirm-sos'){void prepareSosAlert();return}
  if(a==='send-sos'){void sendSosAlert();return}
  if(a==='clear-sos'){clearSosStatus();return}
  if(a==='cancel-sos-preparation'){closeModal();clearSosStatus();speak('Emergency alert preparation cancelled.');return}
  if(a==='edit-sos-contact'){const id=Number(el.dataset.id);closeModal();formDialog('contact',id);return}
  if(a==='open-sms-app'&&sosFallback){window.location.href=sosFallback.url;sosDetail='Messages app opened. Check the recipient and press Send; VisionGuide cannot confirm a manual SMS.';return}
  if(a==='copy-sos-message'&&sosFallback){
    const copy=navigator.clipboard?.writeText?.(sosFallback.message);
    if(copy?.then)copy.then(()=>toast('Emergency text copied. Paste it into Messages and press Send.'),()=>toast('Copy failed. Open your Messages app instead.'));
    else toast('Copy is unavailable. Open your Messages app instead.');
  }
},true);
// ── Main click handler ─────────────────────────────────────────────
document.addEventListener('click',e=>{const el=e.target.closest('button');if(!el)return;if(el.dataset.toggle){const key=el.dataset.toggle;settings[key]=!settings[key];if((key==='voice'&&!settings.voice)||(key==='screen'&&settings.screen))cancelVoice();if(key==='history'&&!settings.history)journeys=[];if(key==='location'&&!settings.location){paused=true;clearInterval(timer)}persist();render();requestAnimationFrame(()=>document.querySelector(`[data-toggle="${key}"]`)?.focus());return}if(el.dataset.place){destination={...places.find(p=>p.id===Number(el.dataset.place))};go('preview');return}if(el.dataset.journey){const j=journeys[Number(el.dataset.journey)];modal(esc(j.name),`<div class="detail-grid">${[['Origin','Bandra West, Mumbai'],['Destination',j.name],['Duration',j.duration],['Distance',j.distance],['Status',j.status]].map(([k,v])=>`<div><small>${k}</small><strong>${esc(v)}</strong></div>`).join('')}</div><div class="list-actions">${btn('Close','close-modal','primary')}</div>`);return}const a=el.dataset.action,id=Number(el.dataset.id);if(!a)return;if(['ocr-start','ocr-scan','ocr-auto','ocr-stop','ocr-speak'].includes(a))return;if(handleCameraAction(a,id))return;if(['home','navigate','environment','read','activity','settings','accessibility','sos','places','contacts','privacy','practice','setup','permissions','guidance'].includes(a)){go(a);return}switch(a){case'complete-onboarding':onboarded=true;persist();go('home');break;case'replay-onboarding':go('welcome');break;case'enable-location':settings.location=true;persist();render();toast('Demo location enabled');break;case'begin':if(!settings.location){go('navigate');break}active=true;step=0;paused=!settings.auto;go('guidance');speak(sequence[0][0]);startTimer();break;case'next':advance(1);break;case'previous':advance(-1);break;case'pause':paused=!paused;startTimer();render();break;case'map':mapVisible=!mapVisible;render();break;case'repeat':speak(sequence[step][0]+'. '+sequence[step][1]);toast(settings.voice?'Reading current instruction':'Voice guidance is off');break;case'finish':finish(true);break;case'end-demo':modal('End this demo journey?',`<p>You can begin a new journey any time.</p><div class="list-actions">${btn('Keep going','close-modal')}${btn('End Demo','confirm-end','primary')}</div>`);break;case'confirm-end':closeModal();finish(false);break;case'confirm-sos':modal('Activate a demo SOS?',`<p>${contacts.length?'Your primary contact and sample location will appear in a simulated alert.':'Add an emergency contact before activating SOS.'}</p><p class="muted">No one will be contacted.</p><div class="list-actions">${btn('Cancel','close-modal')}${contacts.length?btn('Confirm SOS','activate-sos','danger'):btn('Add Contact','sos-add-contact','primary')}</div>`);break;case'sos-add-contact':closeModal();go('contacts');formDialog('contact');break;case'activate-sos':closeModal();sosActive=true;render();speak('Demo emergency alert active');break;case'cancel-sos':sosActive=false;render();toast('Demo alert cancelled');break;case'add-contact':formDialog('contact');break;case'edit-contact':formDialog('contact',id);break;case'primary-contact':contacts=contacts.map(c=>({...c,primary:c.id===id}));persist();render();break;case'remove-contact':case'remove-place':modal('Remove this '+(a==='remove-contact'?'contact':'place')+'?',`<p>You can add it again later.</p><div class="list-actions">${btn('Cancel','close-modal')}${btn('Remove',a==='remove-contact'?'delete-contact':'delete-place','danger',`data-id="${id}"`)}</div>`);break;case'delete-contact':contacts=contacts.filter(c=>c.id!==id);if(contacts.length&&!contacts.some(c=>c.primary))contacts[0].primary=true;closeModal();persist();render();break;case'delete-place':places=places.filter(p=>p.id!==id);closeModal();persist();render();break;case'add-place':case'add-destination':formDialog('place');break;case'rename-place':formDialog('place',id);break;case'set-home':places=places.map(p=>({...p,home:p.id===id}));persist();render();break;case'disconnect':device='Disconnected';paused=true;clearInterval(timer);render();toast('Demo device disconnected. Navigation paused.');break;case'reconnect':device='Connecting';render();setTimeout(()=>{device='Connected';render();toast("Device reconnected. Resume when you're ready.")},1000);break;case'start-practice':practice=true;practiceIndex=0;render();speak(practiceCommands[0][0]);break;case'practice-cue':practiceIndex=id;render();speak(practiceCommands[id][0]);break;case'finish-practice':practice=false;go('home');toast("Practice finished. You're ready to explore.");break;case'read-text':readIndex=(readIndex+1)%sampleSigns.length;render();speak(sampleSigns[readIndex]);toast('Reading: '+sampleSigns[readIndex]);break;case'read-aloud':if(readIndex>=0){speak(sampleSigns[readIndex]);toast('Reading: '+sampleSigns[readIndex]);}break;case'close-read':readIndex=-1;render();break;case'test-voice':speak('Continue straight for 40 metres');toast(settings.voice?'Voice preview: Continue straight for 40 metres':'Turn on voice guidance to hear the preview');break;case'safety-stop':case'safety-car':modal(a==='safety-stop'?'STOP':'Vehicle nearby',`<div class="alert-box"><div class="direction">${icon('sos')}</div><h2>${a==='safety-stop'?'Obstacle directly ahead':'Wait before continuing'}</h2><p>Sample safety alert</p></div><div class="list-actions">${btn('Understood','close-modal','primary')}</div>`);speak(a==='safety-stop'?'Stop. Obstacle directly ahead':'Vehicle nearby. Wait before continuing');break;case'close-modal':closeModal();break;case'more':modal('More from VisionGuide',`<div class="stack">${[['camera','Camera guide'],['read','Read a sign'],['environment','Around You'],['activity','Recent Journeys'],['practice','Practice Mode'],['places','Saved Places'],['settings','Settings']].map(([p,t])=>btn(icon(p)+' '+t,'modal-nav','',`data-page="${p}"`)).join('')}${btn('Close','close-modal','text-button')}</div>`);break;case'modal-nav':closeModal();go(el.dataset.page);break;}});
$('#modal').addEventListener('click',e=>{
  if(e.target!==$('#modal'))return;
  const r=e.target.getBoundingClientRect();
  if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom)return;
  closeModal();
  if(page==='sos'&&sosPhase==='ready')clearSosStatus();
});
$('#modal').addEventListener('cancel',e=>{if(page==='sos'&&sosPhase==='ready'){e.preventDefault();closeModal();clearSosStatus()}});

/* Public command bridge used by voiceCommands.js. Voice commands and buttons
   deliberately share these functions so they cannot drift into separate flows. */
window.visionGuideAPI = {
  getState: () => ({ page, cameraState, cameraDemo, ocrCamActive, active:window.navigationUI?.isActive?.()||active, paused, sosActive, sosPhase }),
  speak,
  toast,
  async startCamera() {
    if (page !== 'camera') go('camera');
    if (cameraState === 'live') { speak('The camera is already on.'); return true; }
    await requestCamera();
    return cameraState === 'live';
  },
  stopCamera() {
    if (!cameraActive() && cameraState !== 'requesting') { speak('The camera is already off.'); return; }
    cameraDemo = false;
    stopCamera();
    if (page === 'camera') render();
    speak('Camera is off.');
  },
  async readText() {
    if (page !== 'read') go('read');
    if (!ocrCamActive) await startOcrCamera();
    if (!ocrCamActive || !window.ocrAPI) {
      speak('I could not start the text camera. Please allow camera access and try again.');
      return null;
    }
    if (!window.ocrAPI.isReady()) {
      speak('The text reader is loading. I will scan when it is ready.');
      try { await window.ocrAPI.loadWorker(); }
      catch { speak('The text reader could not load. Check your connection and try again.'); return null; }
      const started=Date.now();
      while (!window.ocrAPI.isReady() && Date.now()-started < 20000)
        await new Promise(resolve=>setTimeout(resolve,250));
    }
    if (!window.ocrAPI.isReady()) {
      speak('The text reader is not ready yet. Please try again in a moment.');
      return null;
    }
    const result=await window.ocrAPI.scanOnce();
    if (result?.accepted) render();
    else speak('I could not find readable text. Hold the camera steady and try again.');
    return result;
  },
  whereAmI() {
    if (window.navigationUI?.getState?.()?.location) { window.navigationUI.whereAmI(); return; }
    if (!settings.location) { speak('The demo location is turned off. Open settings to turn it on.'); return; }
    const journey=active&&destination?` You are on the demo route to ${destination.name}.` : '';
    speak(`You are at Bandra West, Mumbai, using the demo location.${journey}`);
  },
  describeSurroundings() {
    if (cameraState === 'live') {
      const description=window.objectDetectionAPI?.describeLatest?.();
      speak(description || 'The camera is on, but I do not have a recent detection yet. Hold it steady while the scene is analysed.');
      return;
    }
    if (cameraDemo) { speak(cameraSpeech()); return; }
    speak('The camera is off. Say start camera to analyse what is ahead.');
  },
  navigateHome() {
    const homePlace=places.find(p=>p.home)||places.find(p=>p.name.toLowerCase()==='home');
    if (!homePlace) { speak('No home place is saved. Open saved places to set one.'); return false; }
    if (window.navigationUI) { if(page!=='navigate')go('navigate'); return window.navigationUI.selectPlace(homePlace.id); }
    destination={...homePlace}; go('preview');
    speak(`Route to ${homePlace.name} is ready. Say begin navigation when you are ready.`);
    return true;
  },
  navigateTo(name) {
    if (window.navigationUI) return window.navigationUI.navigateToName(name);
    const query=String(name||'').trim().toLowerCase();
    const found=places.find(p=>p.name.toLowerCase()===query)||places.find(p=>(p.name+' '+p.address).toLowerCase().includes(query));
    if (!found) { speak(`I could not find ${name} in your saved places.`); return false; }
    destination={...found}; go('preview');
    speak(`Route to ${found.name} is ready. Say begin navigation when you are ready.`);
    return true;
  },
  beginNavigation() {
    if (window.navigationUI) { void window.navigationUI.start(); return true; }
    if (!destination) { go('navigate'); speak('Choose a destination before starting navigation.'); return false; }
    if (!settings.location) { speak('Location is off. Turn it on before starting navigation.'); return false; }
    active=true; step=0; paused=!settings.auto; go('guidance');
    speak(sequence[0][0]+'. '+sequence[0][1]); startTimer();
    return true;
  },
  emergency() {
    go('sos');
    speak('Emergency screen open. Say confirm emergency to get your live location and review the recipient. VisionGuide contacts your saved person, not public emergency services.');
  },
  async confirmEmergency() {
    if (page !== 'sos') { speak('Open the emergency screen first by saying emergency.'); return false; }
    if (!contacts.length) { speak('No emergency contact is saved. Add a real mobile number before using SOS.'); return false; }
    if(sosPhase==='ready'&&sosPreparedContact&&sosLocation)return sendSosAlert();
    return prepareSosAlert();
  },
  cancelEmergency() {
    if ($('#modal')?.open) closeModal();
    if (sosActive) { clearSosStatus(); speak('The on-screen status was cleared. A sent SMS cannot be recalled.'); return; }
    if (sosPhase!=='idle') { clearSosStatus(); speak('Emergency alert preparation cancelled.'); return; }
    speak('There is no emergency alert in progress.');
  },
  repeat() {
    const text=lastSpokenText;
    speak(text||'There is nothing to repeat yet.');
  },
  currentInstruction() {
    if (window.navigationUI?.isActive?.()) { window.navigationUI.currentInstruction(); return; }
    if (active) { speak(sequence[step][0]+'. '+sequence[step][1]); return; }
    if (cameraActive()) { this.describeSurroundings(); return; }
    const latest=window.ocrAPI?.getHistory?.()?.[0];
    if (page === 'read' && latest?.text) { speak('Last read text: '+latest.text); return; }
    speak(`You are on the ${page.replace('-', ' ')} screen.`);
  },
  goTo(target) {
    const allowed=['home','camera','navigate','environment','read','settings','accessibility','activity','places','contacts','practice','privacy'];
    if (!allowed.includes(target)) return false;
    go(target); speak(`Opened ${target === 'environment' ? 'around you' : target}.`);
    return true;
  },
  help() {
    speak('You can say: start camera, stop camera, what is ahead, read text, where am I, navigate to a destination, select result 1, begin navigation, stop navigation, repeat, or emergency.');
  }
};

document.addEventListener('click',e=>{
  const el=e.target.closest?.('[data-place]');
  if(!el||!window.navigationUI)return;
  e.preventDefault();e.stopImmediatePropagation();
  go('navigate');void window.navigationUI.selectPlace(Number(el.dataset.place));
},true);
window.navigationUI?.configure?.({speak,toast,go,esc,icon});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applySettings);
async function initializeAuth() {
  render();
  if (!window.supabaseAuth) {
    authReady = true;
    page = 'landing';
    render();
    return;
  }
  try {
    const session = await window.supabaseAuth.initialize((event, nextSession) => {
      authenticated = Boolean(nextSession);
      authReady = true;
      if (event === 'PASSWORD_RECOVERY') {
        passwordRecovery = true;
        page = 'reset';
        render();
        return;
      }
      if (event === 'SIGNED_OUT') {
        passwordRecovery = false;
        page = 'landing';
        render();
        return;
      }
      if (nextSession && ['INITIAL_SESSION', 'SIGNED_IN'].includes(event) &&
          ['auth-loading', 'landing', 'signin', 'signup', 'forgot'].includes(page)) {
        page = onboarded ? 'home' : 'welcome';
        render();
      }
    });
    authenticated = Boolean(session);
    authReady = true;
    if (!passwordRecovery) page = authenticated ? (onboarded ? 'home' : 'welcome') : 'landing';
    render();
  } catch (error) {
    authReady = true;
    authenticated = false;
    page = 'landing';
    render();
    toast(friendlyAuthError(error));
  }
}
void initializeAuth();
