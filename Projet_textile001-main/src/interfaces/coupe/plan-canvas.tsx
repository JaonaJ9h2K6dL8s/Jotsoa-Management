'use client';

import { useId, useState } from 'react';
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import type { NestingInput, NestingResult } from '@/server/coupe/nesting';
import { labelAnchor } from '@/lib/coupe-geometry';

const palette=['#65b9b0','#efc562','#a2d2bf','#117b91','#c7b6dc','#eda68e'];
export default function PlanCanvas({result,editable,onMove}:{result:NestingResult;editable:boolean;onMove:(layout:NonNullable<NestingInput['manualLayout']>)=>void}) {
  const prefix=useId().replace(/:/g,'');
  const [zoom,setZoom]=useState(1);
  const [selected,setSelected]=useState(0);
  const [position,setPosition]=useState<{x:number;y:number;rotation:number}|null>(null);
  const length=result.matelasLengthCm ?? result.markerLengthCm;
  const width=result.usableWidthCm;
  const sizes=[...new Set(result.placements.map((piece)=>piece.sizeId))];
  const selectedPiece=result.placements[selected];
  const value=position??selectedPiece;
  const select=(index:number)=>{setSelected(index);setPosition(null);};
  return <Stack spacing={1.5}>
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
      <Typography variant="subtitle1">Plan proportionnel — {length.toFixed(1)} × {width.toFixed(1)} cm</Typography>
      <Button onClick={()=>setZoom(Math.max(0.5,zoom-0.25))}>− Zoom</Button><Button onClick={()=>setZoom(Math.min(4,zoom+0.25))}>+ Zoom</Button>
      {sizes.map((sizeId,index)=><Chip key={sizeId} size="small" label={result.placements.find((piece)=>piece.sizeId===sizeId)?.sizeNom} sx={{backgroundColor:palette[index%palette.length]}} />)}
    </Stack>
    <Box sx={{overflow:'auto',border:'1px solid',borderColor:'divider',borderRadius:2,bgcolor:'#f6f8fa',p:2,maxHeight:650}}>
      <svg role="img" aria-label="Plan de coupe calculé depuis les contours des patrons" viewBox={`-18 -18 ${length+36} ${width+36}`} style={{display:'block',width:`${zoom*100}%`,minWidth:600}}>
        <rect width={length} height={width} fill="#fff2e7" stroke="#263c46" strokeWidth={0.4}/>
        <rect x={result.marginCm??0} y={result.marginCm??0} width={Math.max(0,length-2*(result.marginCm??0))} height={Math.max(0,width-2*(result.marginCm??0))} fill="none" stroke="#b56c27" strokeDasharray="2 2" strokeWidth={0.3}/>
        <text x={length/2} y={-7} textAnchor="middle" fontSize={5} fill="#166b93">Longueur du matelas : {length.toFixed(1)} cm</text>
        <text transform={`translate(-7 ${width/2}) rotate(-90)`} textAnchor="middle" fontSize={5} fill="#166b93">Largeur utile : {width.toFixed(1)} cm</text>
        {(result.defects??[]).map((zone,index)=><g key={index}><rect x={length-zone.y-zone.heightCm} y={zone.x} width={zone.heightCm} height={zone.widthCm} fill="#f1939390" stroke="#a00" strokeWidth={0.6}/><title>{zone.label}</title></g>)}
        {result.placements.map((piece,index)=>{
          const mapped=piece.points.map((point)=>`${length-point.y},${point.x}`).join(' ');
          const anchor=labelAnchor(piece.points);
          const pattern=result.patternPieces.find((candidate)=>candidate.id===piece.patternId);
          const radians=piece.rotation*Math.PI/180;
          const nativeX=pattern?.grainDirection==='cross'?1:0;
          const nativeY=pattern?.grainDirection==='cross'?0:1;
          const directionX=-(nativeX*Math.sin(radians)+nativeY*Math.cos(radians));
          const directionY=nativeX*Math.cos(radians)-nativeY*Math.sin(radians);
          const arrowLength=Math.min(piece.widthCm,piece.heightCm)*0.2;
          const anchorX=length-anchor.y;
          return <g key={index} onClick={()=>select(index)} style={{cursor:'pointer'}}>
            <defs><clipPath id={`${prefix}-${index}`}><polygon points={mapped}/></clipPath></defs>
            <polygon points={mapped} fill={palette[sizes.indexOf(piece.sizeId)%palette.length]} stroke={selected===index?'#172f3d':'#34454e'} strokeWidth={selected===index?0.9:0.35}/>
            <g clipPath={`url(#${prefix}-${index})`}>
              <text x={anchorX} y={anchor.x-2} textAnchor="middle" fontSize={Math.min(4,Math.min(piece.widthCm,piece.heightCm)/4)} fill="#142c37">{index+1} · {piece.sizeNom}</text>
              {pattern?.grainDirection!=='any'&&<g stroke="#34454e" strokeWidth={0.4}><line x1={anchorX-directionX*arrowLength} y1={anchor.x+2-directionY*arrowLength} x2={anchorX+directionX*arrowLength} y2={anchor.x+2+directionY*arrowLength}/><circle cx={anchorX+directionX*arrowLength} cy={anchor.x+2+directionY*arrowLength} r={0.7}/></g>}
            </g>
            <title>{`${index+1}. ${piece.pieceLabel} — ${piece.sizeNom} — ${pattern?.component??''} — ${piece.rotation}° — ${pattern?.version??''}`}</title>
          </g>;
        })}
      </svg>
    </Box>
    {selectedPiece&&<Stack spacing={1}>
      <Typography variant="body2">Pièce {selected+1} : {selectedPiece.pieceLabel} · {selectedPiece.sizeNom} · {result.patternPieces.find((piece)=>piece.id===selectedPiece.patternId)?.component} · {selectedPiece.rotation}°</Typography>
      {editable&&value&&<Stack direction={{xs:'column',sm:'row'}} spacing={1}>
        {(['x','y','rotation'] as const).map((field)=><TextField key={field} size="small" type="number" label={field==='rotation'?'Rotation (°)':`${field.toUpperCase()} dans le plan (cm)`} value={value[field]} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setPosition({...value,[field]:Number(event.target.value)})}/>)}
        <Button variant="outlined" onClick={()=>{onMove(result.placements.map((piece,index)=>({patternId:piece.patternId,x:piece.x,y:piece.y,rotation:piece.rotation,...(index===selected?value:{})})));setPosition(null);}}>Déplacer et contrôler</Button>
      </Stack>}
    </Stack>}
    <Typography variant="caption">{result.method??'Plan historique'} — aucun optimum global garanti. Les numéros identifient les pièces ; sélectionnez une pièce pour son nom. Le défilement horizontal et vertical permet de parcourir le plan zoomé.</Typography>
  </Stack>;
}
