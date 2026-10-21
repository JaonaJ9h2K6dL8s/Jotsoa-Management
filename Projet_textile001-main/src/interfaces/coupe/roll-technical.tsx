'use client';
import { useState } from 'react';
import { Alert, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import type { AtelierData } from '@/routes/coupe/atelier';

export default function RollTechnical({data,busy,act}:{data:AtelierData;busy:boolean;act:(action:string,input?:unknown,id?:number)=>Promise<unknown>}) {
  const [id,setId]=useState('');
  const [values,setValues]=useState({widthCm:'',usableWidthCm:'',grammageGm2:'',remainingM:'',maxLayers:'',fabricLot:'',motif:'',thicknessMm:'',maxMatelasMm:''});
  const [reviewed,setReviewed]=useState(false);
  function select(raw:string) {
    setId(raw);setReviewed(false);
    const roll=data.rolls.find((item)=>item.id===Number(raw));
    if (!roll) return;
    const constraints=JSON.parse(roll.constraintsJson) as Record<string,unknown>;
    setValues({widthCm:String(roll.widthCm??''),usableWidthCm:String(roll.usableWidthCm??''),grammageGm2:String(roll.grammageGm2??''),remainingM:roll.unit==='m'?String(roll.remainingM??''):'',
      maxLayers:String(constraints.maxLayers??''),fabricLot:roll.fabricLot??'',motif:String(constraints.motif??''),thicknessMm:String(constraints.thicknessMm??''),maxMatelasMm:String(constraints.maxMatelasMm??'')});
  }
  return <Stack spacing={2}>
    <Typography variant="h6">Caractéristiques réelles du rouleau</Typography>
    <Alert severity="info">Ces valeurs sont enregistrées une fois et reprises dans la préparation. La longueur n’est pas inventée à partir du poids. Les limites doivent être contrôlées pour ce tissu et votre matériel.</Alert>
    <TextField select label="Rouleau" value={id} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>select(event.target.value)}>{data.rolls.map((roll)=><MenuItem key={roll.id} value={roll.id}>{roll.code} — {roll.fabricRef}</MenuItem>)}</TextField>
    {([['widthCm','Largeur réelle (cm)'],['usableWidthCm','Largeur utile (cm)'],['grammageGm2','Grammage (g/m²)'],['remainingM','Longueur restante mesurée (m)'],['maxLayers','Couches maximales autorisées'],['thicknessMm','Épaisseur par couche (mm), si connue'],['maxMatelasMm','Épaisseur maximale de coupe (mm), si connue'],['fabricLot','Lot du tissu']] as const).map(([field,label])=><TextField key={field} label={label} type={field==='fabricLot'?'text':'number'} value={values[field]} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{setValues({...values,[field]:event.target.value});setReviewed(false);}}/>)}
    <TextField select label="Motif / sens du tissu" value={values.motif} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>{setValues({...values,motif:event.target.value});setReviewed(false);}}>
      <MenuItem value="uni">Uni sans sens imposé</MenuItem><MenuItem value="sens_unique">Sens unique</MenuItem><MenuItem value="rayures">Rayures — raccord non pris en charge</MenuItem><MenuItem value="motif">Motifs — raccord non pris en charge</MenuItem>
    </TextField>
    <FormControlLabel control={<Checkbox checked={reviewed} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setReviewed(event.target.checked)}/>} label="Limites, élasticité, sens, épaisseur et contraintes contrôlés pour cette matière et ce matériel."/>
    <Button disabled={busy||!id||!reviewed} variant="contained" onClick={()=>void act('roll',{id:Number(id),...values,reviewed})}>Enregistrer le contrôle du rouleau</Button>
  </Stack>;
}
