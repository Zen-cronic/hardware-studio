import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Navigate } from '../App';
import type { Part } from '../shared/types';
import { CATALOG } from '../shared/catalog';
import './landing-build-story.css';

export default function LandingBuildStory({parts,navigate,onSize}:{parts:Part[];navigate:Navigate;onSize:(size:number)=>void}) {
  const sheet=useRef<HTMLDivElement>(null);
  const [revealed,setRevealed]=useState(false);
  useEffect(()=>{
    if(!sheet.current)return;
    const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setRevealed(true);observer.disconnect();}},{threshold:.25});
    observer.observe(sheet.current);return()=>observer.disconnect();
  },[]);
  const platter=parts.find(p=>p.id==='platter')!;
  const base=parts.find(p=>p.id==='base-floor')!;
  const rows=['platter','base-floor','motor-plate'].map(id=>parts.find(p=>p.id===id)!).filter(Boolean);
  const products=CATALOG.filter(p=>p.kind!=='custom');
  const physicalCount=parts.filter(p=>p.role!=='reference').length;
  return <>
    <section className="landing-build-story" aria-labelledby="landing-build-title">
      <div className="landing-build-copy">
        <p className="eyebrow">From design to build files</p>
        <h2 id="landing-build-title">Build files<br/>come with it.</h2>
        <p>The same dimensions shape the 3D model, parts list and assembly instructions. See what changes before you start making.</p>
        <button className="button" onClick={()=>navigate('/judge')}>Explore the workflow <ChevronRight size={18}/></button>
      </div>
      <div className="landing-build-sheet surface-build" ref={sheet} data-revealed={revealed} aria-label="Live turntable dimensions and sample parts">
        <header><strong>Motorized turntable</strong><span>Parts & dimensions</span></header>
        <div className="landing-sheet-drawing">
          <svg viewBox="-170 -170 340 340" role="img" aria-label={`Top view: ${platter.size[0]} millimeter platter and ${base.size[0]} millimeter base`}>
            <path className="sheet-centerline" d="M-156 0h312M0-156v312"/>
            <circle pathLength="1" className="sheet-platter" r={platter.size[0]/2}/>
            <circle className="sheet-base" r={base.size[0]/2}/>
            {platter.holes?.map((hole,i)=><circle className="sheet-hole" key={i} cx={hole.x} cy={hole.z} r={hole.diameter/2}/>)}
            {platter.holeDiameter ? <circle className="sheet-hole" r={platter.holeDiameter/2}/> : null}
            <path pathLength="1" className="sheet-dimension" d={`M${-platter.size[0]/2} 150h${platter.size[0]}M${-platter.size[0]/2} 142v16M${platter.size[0]/2} 142v16`}/>
          </svg>
          <dl><div><dt>Platter</dt><dd>{platter.size[0]}<span>mm</span></dd></div><div><dt>Base</dt><dd>{base.size[0]}<span>mm</span></dd></div></dl>
        </div>
        <div className="landing-output-options" role="group" aria-label="Build sheet platter diameter">{[220,280].map(size=><button key={size} className="button" aria-pressed={platter.size[0]===size} onClick={()=>onSize(size)}>{size} mm platter</button>)}</div>
        <table><caption>Selected components</caption><thead><tr><th>Part</th><th>Diameter × thickness</th></tr></thead><tbody>{rows.map(part=><tr key={part.id}><td>{part.name}</td><td>{part.size[0]} × {part.size[1]} mm</td></tr>)}</tbody></table>
        <footer>{rows.length} of {physicalCount} components / dimensions in millimetres</footer>
      </div>
    </section>
    <section className="landing-examples" aria-labelledby="landing-examples-title">
      <header><div><h2 id="landing-examples-title">What it can build today</h2><p>Each one is a working design you can open, change and download.</p></div><button className="button primary" onClick={()=>navigate('/browse')}>Browse all designs <ChevronRight size={18}/></button></header>
      <div className="landing-example-list">
        <button className="lp-example-extra" onClick={()=>navigate('/new')} aria-label="Start with the camera drone">
          <img className="lp-example-render" src="/previews/drone.png" alt="" loading="lazy" width="650" height="450"/>
          <span className="lp-example-name">Camera drone</span>
        </button>
        <button className="lp-example-extra" onClick={()=>navigate('/new')} aria-label="Start with the articulated camera arm">
          <img className="lp-example-render" src="/previews/arm.png" alt="" loading="lazy" width="1100" height="806"/>
          <span className="lp-example-name">Articulated camera arm</span>
        </button>
        {products.map(product=><button className="landing-example" key={product.kind} onClick={()=>navigate('/designs/'+product.kind)} aria-label={`Explore ${product.name}`}>
        <img src={`/previews/${product.kind}.png`} alt="" loading="lazy" width="1100" height={product.kind==='turntable'?1150:760}/>
        <span>{product.name}</span>
      </button>)}

      </div>
      <p className="landing-start-shape">Have something else in mind? <button className="button" onClick={()=>navigate('/new')}>Start from a shape</button></p>
    </section>
  </>;
}
