'use client';
import { useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import type { MarkerPlanRow } from '@/server/coupe/marker';

export default function ActualForm({plan,busy,act}:{plan:MarkerPlanRow;busy:boolean;act:(action:string,input?:unknown,id?:number)=>Promise<void>}) {
  const [values,setValues]=useState({lengthM:'',layers:'',weightKg:'',reusableKg:'',wasteKg:'',reason:''});
  const [counts,setCounts]=useState<Record<number,{cutQty:string;usableQty:string}>>({});
  if (plan.actual) return <Alert severity="success">Résultats réels enregistrés et tâche de coupe validée. Les composants restent consultables dans le ticket de suivi ; la remise physique et la réception couture restent à confirmer séparément.</Alert>;
  return <Stack spacing={2}>
    <Alert severity="info">Saisissez uniquement les mesures et comptages réels. Rien n’est prérempli avec l’estimation. Pour un ensemble, seules les unités complètes haut + short alimentent les quantités transférables.</Alert>
    <Stack direction={{xs:'column',md:'row'}} spacing={1}>{([['lengthM','Longueur réelle du matelas (m)'],['layers','Couches réelles'],['weightKg','Poids total utilisé (kg)'],['reusableKg','Chutes récupérables (kg)'],['wasteKg','Déchets non récupérables (kg)']] as const).map(([field,label])=><TextField key={field} fullWidth size="small" type="number" label={label} value={values[field]} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setValues({...values,[field]:event.target.value})}/>)}</Stack>
    {plan.result?.patternPieces.map((piece)=>{
      const row=counts[piece.id]??{cutQty:'',usableQty:''};
      const expected=(plan.sizes.find((size)=>size.sizeId===piece.sizeId)?.qty??0)*piece.qtyMultiplier;
      return <Stack direction={{xs:'column',sm:'row'}} spacing={1} key={piece.id} alignItems="center">
        <Typography sx={{flex:1}}>{piece.component} · {piece.pieceLabel} · {piece.sizeNom} (prévu {expected} pièces)</Typography>
        <TextField size="small" type="number" label="Pièces réellement coupées" value={row.cutQty} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setCounts({...counts,[piece.id]:{...row,cutQty:event.target.value}})}/>
        <TextField size="small" type="number" label="Pièces utilisables" value={row.usableQty} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setCounts({...counts,[piece.id]:{...row,usableQty:event.target.value}})}/>
      </Stack>;
    })}
    <TextField label="Défauts constatés et motif des écarts" multiline minRows={2} value={values.reason} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setValues({...values,reason:event.target.value})}/>
    <Button variant="contained" disabled={busy||Object.entries(values).some(([key,value])=>key!=='reason'&&!value)||plan.result?.patternPieces.some((piece)=>!counts[piece.id]?.cutQty||!counts[piece.id]?.usableQty)} onClick={()=>void act('actual',{...values,components:plan.result?.patternPieces.map((piece)=>({patternId:piece.id,...counts[piece.id]}))},plan.id)}>Confirmer les mesures et valider les résultats</Button>
  </Stack>;
}
