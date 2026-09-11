import { useEffect, useMemo, useRef, useState } from 'react';
import type { BirthProfile, ChartData } from '../types';

const revealOrder = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu'];
const glyph: Record<string,string> = { Sun:'☉', Moon:'☾', Mercury:'☿', Venus:'♀', Mars:'♂', Jupiter:'♃', Saturn:'♄', Rahu:'☊', Ketu:'☋' };
const positions: Record<string,{x:number;y:number}> = {
  Sun:{x:48,y:49}, Moon:{x:51,y:43}, Mercury:{x:61,y:54}, Venus:{x:38,y:64}, Mars:{x:68,y:32}, Jupiter:{x:29,y:29}, Saturn:{x:25,y:56}, Rahu:{x:77,y:24}, Ketu:{x:58,y:75}
};
const zodiac = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
/*
 * Interpretation text is now COMPOSED from the active chart rather than hardcoded.
 *
 * These strings previously stated fixed placements ("The Sun is in Capricorn in House 3
 * at 12°44′"). Now that each user gets a generated chart, baked-in placements would
 * contradict the chart drawn beside them.
 *
 * Each planet keeps its own traditional theme, and each house its own domain; the
 * sentence is assembled from the real sign, house and degree.
 */
const planetThemes: Record<string,string> = {
 Sun:'vitality, confidence and a sense of purpose',
 Moon:'emotional rhythm, memory and instinctive care',
 Mars:'drive, courage and the will to act',
 Mercury:'communication, analysis and learning',
 Jupiter:'growth, counsel and generosity',
 Venus:'affection, harmony and an eye for beauty',
 Saturn:'patience, structure and endurance',
 Rahu:'ambition and attraction toward the unfamiliar',
 Ketu:'reflection, detachment and inherited skill'
};

const houseDomains: Record<number,string> = {
 1:'self, outlook and how you meet the world',
 2:'resources, speech and what you value',
 3:'courage, siblings and short journeys',
 4:'home, belonging and inner foundations',
 5:'creativity, learning and self-expression',
 6:'routines, service and the meeting of challenges',
 7:'partnership and one-to-one relationships',
 8:'depth, transformation and shared resources',
 9:'belief, mentors and long journeys',
 10:'work, standing and public direction',
 11:'friendships, networks and gains',
 12:'retreat, imagination and inner space'
};

function interpretationFor(planet: { name: string; sign: string; house: number; degree: string; strength: string } | undefined) {
 if (!planet) return 'This placement is part of your illustrative birth sky.';
 const retro = planet.strength === 'Retrograde' ? ' retrograde' : '';
 const theme = planetThemes[planet.name] ?? 'its traditional themes';
 const domain = houseDomains[planet.house] ?? 'this area of life';
 const note = planet.strength === 'Exalted' ? ' It sits in its sign of exaltation here.'
   : planet.strength === 'Debilitated' ? ' It sits in its sign of debilitation here.'
   : planet.strength === 'Own sign' ? ' It occupies its own sign here.'
   : '';
 return `${planet.name} is${retro} in ${planet.sign} in House ${planet.house} at ${planet.degree}. Traditionally this connects ${theme} with ${domain}.${note}`;
}

export function BirthSkyScene({ chart, profile, focusPlanet, onNext }: { chart: ChartData; profile?: BirthProfile; focusPlanet?: string; onNext: () => void }) {
 const [step,setStep]=useState(0);
 const [transitioning,setTransitioning]=useState(false);
 const lastActive=useRef(revealOrder[0]);
 useEffect(()=>{ const i=focusPlanet?revealOrder.findIndex(n=>n.toLowerCase()===focusPlanet.toLowerCase()):-1; if(i>=0)setStep(i); },[focusPlanet]);
 const activeName=revealOrder[Math.max(0,step)];
 const active=chart.planets.find(p=>p.name===activeName);
 const activePos=positions[activeName]||{x:50,y:50};
 useEffect(()=>{
   if(lastActive.current===activeName)return;
   lastActive.current=activeName;
   setTransitioning(true);
   const t=window.setTimeout(()=>setTransitioning(false),900);
   return()=>window.clearTimeout(t);
 },[activeName]);
 const stars=useMemo(()=>Array.from({length:110},(_,i)=>({left:`${(i*47)%97}%`,top:`${(i*73)%91}%`,s:(i%4)+1,d:(i%7)*.4,drift:(i%5)+1})),[]);
 return <div className="scene-wrap birth-sky-story cinematic-sky">
   <div className="scene-copy"><div className="eyebrow">CHAPTER 02 · YOUR BIRTH SKY</div><h2>The sky at the moment you arrived.</h2><p>{chart.moonSign} Moon · {chart.lagna} Lagna · {chart.nakshatra}</p></div>
   <div className="birth-sky-context"><span>{profile?.place||'Birth location captured by voice'}</span><span>{profile?.date||'Birth date'} · {profile?.time||'Birth time'}</span><strong>Illustrative Vedic chart context</strong></div>
   <div className={`celestial-dome ${transitioning?'is-transitioning':''}`}>
     <div className="nebula nebula-a"/><div className="nebula nebula-b"/>
     <div className="star-depth star-depth-far">{stars.slice(0,55).map((s,i)=><i className={`sky-star drift-${s.drift}`} key={`f-${i}`} style={{left:s.left,top:s.top,width:s.s,height:s.s,animationDelay:`${s.d}s`}}/>)}</div>
     <div className="star-depth star-depth-near">{stars.slice(55).map((s,i)=><i className={`sky-star drift-${s.drift}`} key={`n-${i}`} style={{left:s.left,top:s.top,width:s.s+1,height:s.s+1,animationDelay:`${s.d}s`}}/>)}</div>
     <div className="celestial-stage" style={{transform:`translate(${(50-activePos.x)*1.15}px, ${(50-activePos.y)*.9}px) scale(${transitioning?1.045:1.025})`}}>
       <div className="zodiac-ring">{zodiac.map((z,i)=><span key={z} style={{transform:`rotate(${i*30}deg) translateY(-208px) rotate(${-i*30}deg)`}}>{z}</span>)}</div>
       <div className="constellation-lines"/>
       <svg className="focus-trajectory" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
         <path d={`M 50 50 Q ${(50+activePos.x)/2} ${Math.max(16,Math.min(84,(50+activePos.y)/2-6))} ${activePos.x} ${activePos.y}`} />
       </svg>
       <span className="focus-beacon" style={{left:`${activePos.x}%`,top:`${activePos.y}%`}}/>
       {chart.planets.map((p,index)=>{const pos=positions[p.name]||{x:50,y:50}; const isActive=p.name===activeName; return <button key={p.name} className={`celestial-planet ambient-${(index%4)+1} ${isActive?'active':''}`} style={{left:`${pos.x}%`,top:`${pos.y}%`,animationDelay:`${index*.22}s`}} onClick={()=>setStep(revealOrder.indexOf(p.name))}><b>{glyph[p.name]}</b><span>{p.name}</span></button>})}
     </div>
     <div className="planet-insight" key={activeName}>
       <small>NOW REVEALING</small><h3>{activeName}</h3><div className="placement">{active?.sign} · House {active?.house} · {active?.degree}</div><p>{interpretationFor(active)}</p>
     </div>
     <div className="focus-pill">✦ Jyotishi is focusing on <strong>{activeName}</strong></div>
     <div className="canvas-caption">Celestial birth map · select a Navagraha to explore</div>
   </div>
   <div className="planet-strip navagraha-strip cinematic-strip">{chart.planets.map(p=><button className={`planet-card ${p.name===activeName?'active':''}`} key={p.name} onClick={()=>setStep(revealOrder.indexOf(p.name))}><span className="planet-glyph">{glyph[p.name]}</span><strong>{p.name}</strong><span>{p.sign}</span><small>House {p.house} · {p.degree}</small></button>)}</div>
   <button className="primary-btn scene-next" onClick={onNext}>Transform the sky into my Kundli →</button>
 </div>;
}
