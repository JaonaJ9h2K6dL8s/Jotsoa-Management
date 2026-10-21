'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import type { NestingInput, NestingPlacement, NestingResult } from '@/server/coupe/nesting';
import { bounds, labelAnchor, type Point } from '@/lib/coupe-geometry';
import { candidatePoints, layoutSignature, placementIssue, rotationChoices, snapPosition, type PlacementContext } from '@/lib/plan-editing';

type Layout=NonNullable<NestingInput['manualLayout']>;
type DragState={index:number;x:number;y:number;issue:string|null};
const palette=['#65b9b0','#efc562','#a2d2bf','#117b91','#c7b6dc','#eda68e'];
const SCREEN=(fabric:{x:number;y:number},length:number)=>({x:length-fabric.y,y:fabric.x});

export default function PlanCanvas({result,editable,onMove,onReoptimize}:{result:NestingResult;editable:boolean;
  onMove:(layout:Layout)=>Promise<boolean>;onReoptimize?:()=>void}) {
  const [zoom,setZoom]=useState(1);
  const [grid,setGrid]=useState(false);
  const [selected,setSelected]=useState(0);
  const [position,setPosition]=useState<{x:number;y:number;rotation:number}|null>(null);
  const [local,setLocal]=useState<NestingPlacement[]>(result.placements);
  const [drag,setDrag]=useState<DragState|null>(null);
  const [hist,setHist]=useState<{stack:NestingPlacement[][];cursor:number}>({stack:[],cursor:-1});
  const [message,setMessage]=useState('');
  const svgRef=useRef<SVGSVGElement|null>(null);
  const boxRef=useRef<HTMLDivElement|null>(null);
  const dragRef=useRef<{index:number;origin:{x:number;y:number};start:{x:number;y:number}}|null>(null);
  const panRef=useRef<{x:number;y:number;left:number;top:number}|null>(null);
  const length=result.matelasLengthCm??result.markerLengthCm;
  const width=result.usableWidthCm;
  const context:PlacementContext={widthCm:width,lengthCm:length,marginCm:result.marginCm??0,gapCm:result.gapCm??0.5,oneWay:result.oneWay,
    scaleX:100/result.wShrinkagePct,scaleY:100/result.lShrinkagePct,defects:result.defects};
  const patternOf=(piece:NestingPlacement)=>result.patternPieces.find((candidate)=>candidate.id===piece.patternId);
  const layoutOf=(placements:NestingPlacement[]):Layout=>placements.map((piece)=>({patternId:piece.patternId,x:piece.x,y:piece.y,rotation:piece.rotation}));
  useEffect(()=>{
    setLocal(result.placements);
    setHist((current)=>{
      const signature=layoutSignature(result.placements);
      const top=current.stack[current.cursor];
      if(top&&layoutSignature(top)===signature) return current;
      const stack=[...current.stack.slice(0,current.cursor+1),result.placements].slice(-30);
      return {stack,cursor:stack.length-1};
    });
  },[result]);
  async function commit(placements:NestingPlacement[]):Promise<boolean> {
    const ok=await onMove(layoutOf(placements));
    if(!ok){setLocal(result.placements);setMessage('Contrôle géométrique serveur refusé : retour à la dernière position valide.');}
    return ok;
  }
  async function goTo(cursor:number) {
    const target=hist.stack[cursor];
    if(!target||cursor===hist.cursor) return;
    const previous=hist.cursor;
    setHist({...hist,cursor});
    const ok=await commit(target);
    if(!ok) setHist((current)=>({...current,cursor:previous}));
  }
  function capture(event:React.PointerEvent) {
    try {svgRef.current?.setPointerCapture(event.pointerId);} catch {/* pointeur synthétique : le suivi reste actif sur le svg */}
  }
  function fabricOf(event:React.PointerEvent):{x:number;y:number}|null {
    const svg=svgRef.current;const ctm=svg?.getScreenCTM();
    if(!svg||!ctm) return null;
    const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(ctm.inverse());
    return {x:point.y,y:length-point.x};
  }
  function evaluate(index:number,x:number,y:number,rotation:number):{x:number;y:number;points:Point[];issue:string|null} {
    const piece=local[index];const pattern=patternOf(piece);
    const others=local.filter((_,i)=>i!==index);
    if(!pattern) return {x,y,points:piece.points,issue:'Patron source introuvable pour cette pièce.'};
    const points=candidatePoints(pattern,x,y,rotation,context);
    return {x,y,points,issue:placementIssue({...piece,x,y,rotation,points},others,pattern,rotation,context)};
  }
  function onPieceDown(event:React.PointerEvent,index:number) {
    if(!editable||dragRef.current||panRef.current) return;
    event.stopPropagation();
    const fabric=fabricOf(event);const piece=local[index];
    if(!fabric||!piece) return;
    capture(event);
    dragRef.current={index,origin:{x:piece.x,y:piece.y},start:fabric};
    setSelected(index);setPosition(null);setMessage('');
  }
  function onSvgMove(event:React.PointerEvent) {
    const pan=panRef.current;
    if(pan){const box=boxRef.current!;box.scrollLeft=pan.left-(event.clientX-pan.x);box.scrollTop=pan.top-(event.clientY-pan.y);return;}
    const active=dragRef.current;
    if(!active) return;
    const fabric=fabricOf(event);
    if(!fabric) return;
    const piece=local[active.index];
    const raw={x:active.origin.x+fabric.x-active.start.x,y:active.origin.y+fabric.y-active.start.y};
    const rotated=candidatePoints(patternOf(piece)!,0,0,piece.rotation,context);
    const box=bounds(rotated);
    const others=local.filter((_,i)=>i!==active.index);
    const snapped=snapPosition(raw.x,raw.y,box.width,box.height,others,context);
    let candidate=evaluate(active.index,snapped.x,snapped.y,piece.rotation);
    if(candidate.issue&&(snapped.x!==raw.x||snapped.y!==raw.y)) candidate=evaluate(active.index,raw.x,raw.y,piece.rotation);
    setDrag({index:active.index,x:candidate.issue?raw.x:snapped.x,y:candidate.issue?raw.y:snapped.y,issue:candidate.issue});
  }
  async function onSvgUp(event:React.PointerEvent) {
    const active=dragRef.current;const pan=panRef.current;
    dragRef.current=null;panRef.current=null;
    if(pan) return;
    if(!active) {setDrag(null);return;}
    const fabric=fabricOf(event);
    if(!fabric){setDrag(null);return;}
    const piece=local[active.index];
    const raw={x:active.origin.x+fabric.x-active.start.x,y:active.origin.y+fabric.y-active.start.y};
    const rotated=candidatePoints(patternOf(piece)!,0,0,piece.rotation,context);
    const box=bounds(rotated);
    const others=local.filter((_,i)=>i!==active.index);
    const snapped=snapPosition(raw.x,raw.y,box.width,box.height,others,context);
    let candidate=evaluate(active.index,snapped.x,snapped.y,piece.rotation);
    if(candidate.issue&&(snapped.x!==raw.x||snapped.y!==raw.y)) candidate=evaluate(active.index,raw.x,raw.y,piece.rotation);
    setDrag(null);
    if(candidate.issue){setMessage(`Déplacement annulé : ${candidate.issue} La pièce est revenue à sa dernière position valide.`);return;}
    if(Math.abs(candidate.x-piece.x)<1e-6&&Math.abs(candidate.y-piece.y)<1e-6) return;
    const next=local.map((item,index)=>index===active.index?{...item,x:candidate.x,y:candidate.y,points:candidate.points}:item);
    setLocal(next);
    await commit(next);
  }
  async function rotate(index:number) {
    const piece=local[index];const pattern=patternOf(piece);
    if(!pattern){setMessage('Patron source introuvable pour cette pièce.');return;}
    const choices=rotationChoices(pattern,context);
    if(choices.length<2){setMessage(`Rotation bloquée : seule l’orientation ${piece.rotation}° est autorisée pour ${piece.pieceLabel} (droit-fil ${pattern.grainDirection}${result.oneWay?', tissu sens unique':''}).`);return;}
    const next=choices[(choices.indexOf(piece.rotation)+1)%choices.length]??choices[0];
    const candidate=evaluate(index,piece.x,piece.y,next);
    if(candidate.issue){setMessage(`Rotation refusée : ${candidate.issue}`);return;}
    const nextLayout=local.map((item,i)=>i===index?{...item,rotation:next,points:candidate.points}:item);
    setLocal(nextLayout);
    await commit(nextLayout);
  }
  async function applyPosition() {
    if(!selectedPiece||!position) return;
    const candidate=evaluate(selected,position.x,position.y,position.rotation);
    if(candidate.issue){setMessage(`Position refusée : ${candidate.issue}`);return;}
    const next=local.map((item,index)=>index===selected?{...item,x:position.x,y:position.y,rotation:position.rotation,points:candidate.points}:item);
    setLocal(next);setPosition(null);
    await commit(next);
  }
  function onBackgroundDown(event:React.PointerEvent) {
    const box=boxRef.current;
    if(!box) return;
    capture(event);
    panRef.current={x:event.clientX,y:event.clientY,left:box.scrollLeft,top:box.scrollTop};
  }
  function fit(){setZoom(1);boxRef.current?.scrollTo({left:0,top:0});}
  const rendered=local.map((piece,index)=>{
    if(!drag||drag.index!==index) return piece;
    const pattern=patternOf(piece);
    return pattern?{...piece,x:drag.x,y:drag.y,points:candidatePoints(pattern,drag.x,drag.y,piece.rotation,context)}:piece;
  });
  const selectedPiece=rendered[Math.min(selected,rendered.length-1)];
  const selectedPattern=patternOf(selectedPiece);
  const dragIssue=drag?.issue??null;
  const manual=hist.stack[0]!==undefined&&layoutSignature(local)!==layoutSignature(hist.stack[0]);
  const sizes=[...new Set(result.placements.map((piece)=>piece.sizeId))];
  return <Stack spacing={1.5}>
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
      <Typography variant="subtitle1">Plan interactif — {length.toFixed(1)} × {width.toFixed(1)} cm</Typography>
      <Chip size="small" color={manual?'warning':'default'} label={manual?'Ajusté manuellement':'Placement automatique proposé'}/>
      <Button onClick={()=>setZoom(Math.max(0.5,zoom-0.25))}>− Zoom</Button><Button onClick={()=>setZoom(Math.min(4,zoom+0.25))}>+ Zoom</Button>
      <Button onClick={fit}>Ajuster à l’écran</Button>
      <Button onClick={()=>setGrid(!grid)}>{grid?'Masquer la grille':'Grille 10 cm'}</Button>
      <Button disabled={!editable||hist.cursor<=0} onClick={()=>void goTo(hist.cursor-1)}>↶ Annuler</Button>
      <Button disabled={!editable||hist.cursor>=hist.stack.length-1} onClick={()=>void goTo(hist.cursor+1)}>↷ Rétablir</Button>
      <Button disabled={!editable||hist.cursor<=0} onClick={()=>void goTo(0)}>Retour au placement automatique</Button>
      {onReoptimize&&<Button disabled={!editable} onClick={onReoptimize}>Réoptimiser</Button>}
      {sizes.map((sizeId,index)=><Chip key={sizeId} size="small" label={result.placements.find((piece)=>piece.sizeId===sizeId)?.sizeNom} sx={{backgroundColor:palette[index%palette.length]}} />)}
    </Stack>
    {message&&<Typography variant="body2" color="error" role="alert">{message}</Typography>}
    <Box ref={boxRef} sx={{overflow:'auto',border:'1px solid',borderColor:'divider',borderRadius:2,bgcolor:'#f6f8fa',p:2,maxHeight:650}}>
      <svg ref={svgRef} role="img" aria-label="Plan de coupe interactif en centimètres réels" viewBox={`-18 -18 ${length+36} ${width+36}`}
        style={{display:'block',width:`${zoom*100}%`,minWidth:600,touchAction:'none',userSelect:'none',cursor:dragRef.current?'grabbing':'default'}}
        onPointerDown={onBackgroundDown} onPointerMove={onSvgMove} onPointerUp={(event)=>void onSvgUp(event)}>
        <defs>
          <pattern id={`${length}-${width}-grid`} width={10} height={10} patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#9fb6c2" strokeWidth={0.12}/></pattern>
        </defs>
        <text x={length/2} y={-7} textAnchor="middle" fontSize={5} fill="#166b93">Longueur du matelas : {length.toFixed(1)} cm</text>
        <text transform={`translate(-7 ${width/2}) rotate(-90)`} textAnchor="middle" fontSize={5} fill="#166b93">Largeur utile : {width.toFixed(1)} cm</text>
        <g transform={`matrix(0 1 -1 0 ${length} 0)`}>
          <rect width={width} height={length} fill="#fff2e7" stroke="#263c46" strokeWidth={0.4}/>
          <rect x={result.marginCm??0} y={result.marginCm??0} width={Math.max(0,width-2*(result.marginCm??0))} height={Math.max(0,length-2*(result.marginCm??0))} fill="none" stroke="#b56c27" strokeDasharray="2 2" strokeWidth={0.3}/>
          {grid&&<rect width={width} height={length} fill={`url(#${length}-${width}-grid)`}/>}
          {result.defects.map((zone,index)=><g key={index}><rect x={zone.x} y={zone.y} width={zone.widthCm} height={zone.heightCm} fill="#f1939390" stroke="#a00" strokeWidth={0.6}/><title>{zone.label}</title></g>)}
          {rendered.map((piece,index)=>{
            const pattern=patternOf(piece);
            const stroke=dragIssue&&drag?.index===index?'#d32f2f':selected===index?'#1565c0':'#34454e';
            const anchor=labelAnchor(piece.points);
            const radians=piece.rotation*Math.PI/180;
            const grainX=piece.rotation!==null&&pattern?.grainDirection==='cross'?Math.cos(radians):-Math.sin(radians);
            const grainY=piece.rotation!==null&&pattern?.grainDirection==='cross'?Math.sin(radians):Math.cos(radians);
            const arrow=Math.min(bounds(piece.points).width,bounds(piece.points).height)*0.22;
            return <g key={index} data-piece={index} onPointerDown={(event)=>onPieceDown(event,index)} onClick={()=>{setSelected(index);setPosition(null);}} style={{cursor:editable?'move':'pointer'}}>
              <polygon points={piece.points.map((point)=>`${point.x},${point.y}`).join(' ')} fill={palette[sizes.indexOf(piece.sizeId)%palette.length]} fillOpacity={dragIssue&&drag?.index===index?0.45:0.85} stroke={stroke} strokeWidth={selected===index?0.9:0.35}/>
              {pattern?.grainDirection!=='any'&&<g stroke="#172f3d" strokeWidth={0.35}><line x1={anchor.x-grainX*arrow} y1={anchor.y-grainY*arrow} x2={anchor.x+grainX*arrow} y2={anchor.y+grainY*arrow}/><circle cx={anchor.x+grainX*arrow} cy={anchor.y+grainY*arrow} r={0.55} fill="#172f3d"/></g>}
              <title>{`${index+1}. ${piece.pieceLabel} — ${piece.sizeNom} — ${pattern?.component??''} — rotation ${piece.rotation}° — ${bounds(piece.points).width.toFixed(1)} × ${bounds(piece.points).height.toFixed(1)} cm — V${pattern?.version??'?'}`}</title>
            </g>;
          })}
        </g>
        {rendered.map((piece,index)=>{
          const anchor=labelAnchor(piece.points);const screen=SCREEN(anchor,length);
          return <text key={index} x={screen.x} y={screen.y-2} textAnchor="middle" fontSize={Math.min(4,Math.min(bounds(piece.points).width,bounds(piece.points).height)/4)} fill="#142c37" pointerEvents="none">{index+1} · {piece.sizeNom}</text>;
        })}
        {drag&&(()=>{
          const piece=rendered[drag.index];const anchor=labelAnchor(piece.points);const screen=SCREEN(anchor,length);
          return <text x={screen.x} y={screen.y+4} textAnchor="middle" fontSize={4.5} fill={drag.issue?'#d32f2f':'#1565c0'} fontWeight={600} pointerEvents="none">X {piece.x.toFixed(1)} · Y {piece.y.toFixed(1)} cm{drag.issue?' — position invalide':''}</text>;
        })()}
        {editable&&selectedPattern&&(()=>{
          const piece=rendered[selected];const box=bounds(piece.points);
          return <g onPointerDown={(event)=>event.stopPropagation()} onClick={()=>void rotate(selected)} style={{cursor:'pointer'}}>
            <circle cx={length-box.minY} cy={box.minX} r={2.4} fill="#1565c0" stroke="#fff" strokeWidth={0.5}/>
            <path d={`M ${length-box.minY-1} ${box.minX} L ${length-box.minY+1} ${box.minX} M ${length-box.minY} ${box.minX-1} L ${length-box.minY} ${box.minX+1}`} stroke="#fff" strokeWidth={0.5}/>
            <title>{`Rotation de ${piece.pieceLabel} — angles autorisés : ${rotationChoices(selectedPattern,context).join('°, ')}°`}</title>
          </g>;
        })()}
      </svg>
    </Box>
    {selectedPiece&&<Stack spacing={1}>
      <Typography variant="body2">Pièce {selected+1} : {selectedPiece.pieceLabel} · {selectedPiece.sizeNom} · {selectedPattern?.component} · rotation {selectedPiece.rotation}° · {bounds(selectedPiece.points).width.toFixed(1)} × {bounds(selectedPiece.points).height.toFixed(1)} cm · droit-fil {selectedPattern?.grainDirection}</Typography>
      <Typography variant="caption">Angles autorisés pour cette pièce : {selectedPattern?rotationChoices(selectedPattern,context).map((angle)=>`${angle}°`).join(', '):'inconnus'}. Glissez la pièce (accrochage aux bords et aux pièces voisines), tournez avec la poignée bleue, ou saisissez des coordonnées exactes ci-dessous. Déformation, duplication et suppression sont volontairement indisponibles : les quantités et la géométrie des pièces viennent du lot et des patrons validés, et le serveur refuse tout ajout ou retrait de pièce.</Typography>
      {editable&&<Stack direction={{xs:'column',sm:'row'}} spacing={1}>
        {(['x','y','rotation'] as const).map((field)=><TextField key={field} size="small" type="number" label={field==='rotation'?'Rotation (°)':`${field.toUpperCase()} dans le plan (cm)`} value={(position??selectedPiece)[field]} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setPosition({...((position??selectedPiece) as {x:number;y:number;rotation:number}),[field]:Number(event.target.value)})}/>)}
        <Button variant="outlined" onClick={()=>void applyPosition()}>Déplacer et contrôler</Button>
      </Stack>}
    </Stack>}
    <Typography variant="caption">{result.method??'Plan historique'} — aucun optimum global garanti. Coordonnées en centimètres réels, indépendantes du zoom ; bleu = pièce sélectionnée, rouge = position invalide (contrôle en temps réel puis refus serveur à chaque déplacement). La validation finale reste côté serveur.</Typography>
  </Stack>;
}
